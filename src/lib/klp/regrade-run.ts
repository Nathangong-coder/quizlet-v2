import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { rebuildKlpStates, lockKlpStates } from '@/lib/metrics/state-writer'
import { ANALYSIS_TX_OPTIONS } from '@/lib/analysis/write-answer'
import { buildAnalysisWrites, type AnalysisWrites, ANALYSIS_VERSION } from '@/lib/analysis/persist'
import type { StudySource } from '@/lib/memory/scoring'
import type { KlpStatus } from '@/lib/errors/klp-credit'
import { toStudySource, QUIZ_MODES, type QuizMode } from '@/lib/quiz/mode'
import {
  planAnswerRegrade,
  summarizeRegrade,
  type LiveKlp,
  type PriorResult,
  REGRADE_CARDS_PER_RUN,
  REGRADE_BUDGET_MS,
  type RegradePlan,
  type RegradeTotals,
} from '@/lib/klp/regrade'

/**
 * Executing the re-grade plans (`src/lib/klp/regrade.ts`) against the database.
 *
 * The planner decides everything; this only writes. Two rules shape the code:
 *
 * **No AI call inside a transaction.** A grading call is seconds long and the
 * analysis transaction serializes an advisory lock, a read and a write per key
 * point. Holding one open across a model call turns a slow provider into lock
 * contention on every learner touching those points, and a `P2028` here throws
 * away work that was already paid for. So a `regrade` plan grades first, then
 * opens its transaction.
 *
 * **`rebuildKlpStates` over BOTH id sets.** Superseding does not delete the old
 * `CardKlp` rows, so their `KlpState` rows survive with posteriors built from
 * evidence that is about to move. Replaying only the new ids would leave the
 * dead ones asserting knowledge from observations no longer attached to them.
 * The rebuild's delete branch removes a state whose evidence is gone, which is
 * exactly the needed behaviour — but only if the id is passed in.
 */

/** Everything a card's re-grade needs, read once. */
export interface CardRegradeInput {
  cardId: string
  term: string
  definition: string
  live: LiveKlp[]
  answers: {
    id: string
    userId: string
    mode: StudySource
    answerText: string | null
    starred: boolean
    priorResults: PriorResult[]
  }[]
}

/**
 * Loads the answers whose evidence is STRANDED on a superseded key point.
 *
 * Deliberately NOT every answer on the card. An answer with no
 * `AnswerKlpResult` rows at all is not stranded — it is un-analysed, from
 * before key points existed or from a grader that returned none — and giving it
 * evidence now is a BACKFILL, a different decision with different risks. This
 * job's blast radius is exactly the damage an auto-fix does: evidence that
 * existed and got detached. Widening it here would quietly turn a repair into
 * an invention.
 */
export async function loadCardRegradeInput(cardId: string): Promise<CardRegradeInput | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, term: true, definition: true },
  })
  if (!card) return null

  const live = await prisma.cardKlp.findMany({
    where: { cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, text: true, weight: true },
  })

  const answers = await prisma.quizAnswer.findMany({
    // At least one result pointing at a SUPERSEDED key point. This predicate is
    // the work queue — see the planner's header on why no queue table exists.
    where: { cardId, klpResults: { some: { klp: { supersededAt: { not: null } } } } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      mode: true,
      answer: true,
      klpResults: {
        select: {
          klpId: true,
          status: true,
          credit: true,
          mode: true,
          evidence: true,
          klp: { select: { text: true, supersededAt: true } },
        },
      },
    },
  })
  if (answers.length === 0) return null

  // `starred` is an input to significance, and it is a property of the LEARNER
  // and card, not of the answer — so it is read per user rather than assumed.
  const progress = await prisma.cardProgress.findMany({
    where: { cardId, userId: { in: [...new Set(answers.map((a) => a.userId))] } },
    select: { userId: true, starred: true },
  })
  const starredBy = new Set(progress.filter((p) => p.starred).map((p) => p.userId))

  return {
    cardId: card.id,
    term: card.term,
    definition: card.definition,
    live: live.map((k) => ({ id: k.id, text: k.text })),
    // TWO VOCABULARIES, AND THIS IS THE SEAM. `QuizAnswer.mode` holds a
    // `QuizMode` ('short-answer', 'multiple-choice'); `AnswerKlpResult.mode`
    // and everything in the memory layer hold a `StudySource` ('quiz-sa',
    // 'quiz-mc'). The planner reasons in `StudySource`, so the column must be
    // translated through the single bridge in `src/lib/quiz/mode.ts`.
    //
    // FOUND BY RUNNING IT. Comparing the raw column against `StudySource`
    // matched nothing, so every short-answer answer fell to the carry-only
    // branch and had its evidence DROPPED instead of re-graded — the exact
    // damage this job exists to repair. The unit tests passed throughout
    // because they were written with 'quiz-sa', which is what the RESULT rows
    // use. A fixture-shaped guard again.
    answers: answers.flatMap((a) => (isQuizMode(a.mode) ? [{
      id: a.id,
      userId: a.userId,
      mode: toStudySource(a.mode),
      answerText: a.answer,
      starred: starredBy.has(a.userId),
      priorResults: a.klpResults.map((r) => ({
        klpId: r.klpId,
        klpText: r.klp.text,
        status: r.status as KlpStatus,
        mode: r.mode as StudySource,
        credit: r.credit,
        evidence: r.evidence,
        isLive: r.klp.supersededAt === null,
      })),
    }] : [])),
  }
}

/**
 * Guards the seam above. An unrecognised `QuizAnswer.mode` yields NO plan at
 * all rather than a defaulted one: a mode nobody has reasoned about must not
 * have a learner's evidence rewritten under a guess about what it means.
 */
function isQuizMode(mode: string): mode is QuizMode {
  return (QUIZ_MODES as readonly string[]).includes(mode)
}

/**
 * Applies ONE plan.
 *
 * Everything below happens in a single transaction so a failure cannot leave an
 * answer with half its evidence moved — a state that looks exactly like a
 * genuine partial drop and would never be re-attempted, because the idempotency
 * gate reads "no stranded results" as done.
 */
export async function applyRegradePlan(
  plan: RegradePlan,
  userId: string,
  fresh: AnalysisWrites | null,
): Promise<void> {
  if (plan.action === 'skip') return

  const carriedTargets = plan.carried.map((c) => c.toKlpId)
  const freshTargets = fresh?.klpResults.map((r) => r.klpId) ?? []
  // OLD ids included on purpose: their KlpState rows still exist and still
  // carry the posterior built from the evidence being moved. Replaying only
  // the new ids would leave those asserting knowledge from observations that
  // no longer point at them.
  const affected = [
    ...new Set([
      ...plan.carried.map((c) => c.fromKlpId),
      ...plan.droppedKlpIds,
      ...carriedTargets,
      ...freshTargets,
    ]),
  ]

  await prisma.$transaction(async (tx) => {
    await lockKlpStates(tx, userId, affected)

    // Every prior result goes, then survivors are re-created on live ids. A
    // delete-and-recreate rather than an UPDATE of `klpId`: the unique
    // constraint is (quizAnswerId, klpId), and updating rows one at a time can
    // transiently collide with a row not yet moved.
    await tx.answerKlpResult.deleteMany({ where: { quizAnswerId: plan.answerId } })

    const toWrite =
      plan.action === 'regrade' && fresh
        ? fresh.klpResults
        : plan.carried.map((c) => ({
            klpId: c.toKlpId,
            status: c.status,
            credit: c.credit,
            mode: c.mode,
            evidence: c.evidence ?? undefined,
          }))

    if (toWrite.length > 0) {
      await tx.answerKlpResult.createMany({
        data: toWrite.map((r) => ({ ...r, quizAnswerId: plan.answerId })),
      })
    }

    // Error tags point at key points too (`klpId`, `secondaryKlpId`, both
    // nullable). A tag whose target survived is remapped; one whose target is
    // gone keeps the tag and NULLS the target — `klpId: null` already means
    // "about the whole answer", so the tag stays real while its now-unresolvable
    // specificity is dropped rather than reassigned to a neighbouring point.
    if (plan.action === 'regrade' && fresh) {
      await tx.answerErrorTag.deleteMany({ where: { quizAnswerId: plan.answerId } })
      if (fresh.errorTags.length > 0) {
        await tx.answerErrorTag.createMany({
          data: fresh.errorTags.map((t) => ({ ...t, quizAnswerId: plan.answerId })),
        })
      }
    } else {
      const remap = new Map(plan.carried.map((c) => [c.fromKlpId, c.toKlpId]))
      const tags = await tx.answerErrorTag.findMany({
        where: { quizAnswerId: plan.answerId },
        select: { id: true, klpId: true, secondaryKlpId: true },
      })
      for (const tag of tags) {
        const nextKlpId = tag.klpId === null ? null : (remap.get(tag.klpId) ?? null)
        const nextSecondary =
          tag.secondaryKlpId === null ? null : (remap.get(tag.secondaryKlpId) ?? null)
        if (nextKlpId === tag.klpId && nextSecondary === tag.secondaryKlpId) continue
        await tx.answerErrorTag.update({
          where: { id: tag.id },
          data: { klpId: nextKlpId, secondaryKlpId: nextSecondary },
        })
      }
    }

    await tx.quizAnswer.update({
      where: { id: plan.answerId },
      data: {
        analysisStatus: plan.status,
        analysisVersion: ANALYSIS_VERSION,
        analysisWarnings:
          plan.warnings.length > 0 ? (plan.warnings as unknown as Prisma.InputJsonValue) : undefined,
      },
    })

    // LAST. Replays each affected posterior from surviving evidence, and
    // deletes the state of any key point that now has none.
    await rebuildKlpStates(tx, userId, affected)
  }, ANALYSIS_TX_OPTIONS)
}

export interface RegradeCardResult extends RegradeTotals {
  cardId: string
  plans: RegradePlan[]
}

/**
 * Plans and applies a whole card.
 *
 * `grade` is optional: without it, `regrade` plans are DOWNGRADED to
 * carry-forward rather than skipped, so a run with no AI budget still repairs
 * every answer whose key points merely got renumbered — the typo-fix case,
 * which is both the most common and the one that silently wipes mastery today.
 */
export async function regradeCard(
  cardId: string,
  grade?: (input: {
    term: string
    definition: string
    answer: string
    klps: { ref: number; text: string; kind: string }[]
  }) => Promise<{ klpResults: { klpRef: number; status: KlpStatus; evidence?: string }[] }>,
  opts: { dryRun?: boolean } = {},
): Promise<RegradeCardResult | null> {
  const input = await loadCardRegradeInput(cardId)
  if (!input) return null

  const klpRefs = input.live.map((k) => ({ id: k.id, weight: 3 }))
  const plans: RegradePlan[] = []

  for (const answer of input.answers) {
    let plan = planAnswerRegrade({
      answerId: answer.id,
      mode: answer.mode,
      answerText: answer.answerText,
      priorResults: answer.priorResults,
      live: input.live,
    })

    let fresh: AnalysisWrites | null = null

    if (plan.action === 'regrade') {
      if (!grade) {
        // No grader available. Fall back to pure carry-forward rather than
        // leaving the evidence stranded: a partial repair beats none, and the
        // remaining uncovered points are simply un-evidenced, which is the
        // honest state rather than a guess.
        plan = {
          ...plan,
          action: plan.carried.length === 0 ? 'drop_all' : 'carry_partial',
          status: plan.carried.length === 0 ? 'no_provenance' : 'analyzed',
          warnings: [...plan.warnings, { reason: 'no_grader_available', value: answer.id }],
        }
      } else if (!opts.dryRun) {
        // OUTSIDE the transaction — see the header.
        const graded = await grade({
          term: input.term,
          definition: input.definition,
          answer: answer.answerText ?? '',
          klps: input.live.map((k, i) => ({ ref: i, text: k.text, kind: 'definition' })),
        })
        fresh = buildAnalysisWrites({
          mode: answer.mode,
          klps: klpRefs,
          starred: answer.starred,
          klpResults: graded.klpResults,
          errorTags: [],
        })
      }
    }

    plans.push(plan)
    if (!opts.dryRun) await applyRegradePlan(plan, answer.userId, fresh)
  }

  return { cardId, plans, ...summarizeRegrade(plans) }
}

/**
 * Cards holding at least one answer whose evidence sits on a superseded key
 * point — the work queue, derived rather than stored.
 *
 * Ordered by id for a stable sweep. A card that keeps failing therefore keeps
 * being retried at the front of the queue; that is deliberate while the
 * backlog is small, and is worth revisiting if one ever wedges a run.
 */
export async function findStrandedCardIds(limit: number): Promise<string[]> {
  const rows = await prisma.card.findMany({
    where: { quizAnswers: { some: { klpResults: { some: { klp: { supersededAt: { not: null } } } } } } },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export interface RegradeSweepResult {
  cards: number
  answers: number
  remapped: number
  regraded: number
  droppedAll: number
  resultsCarried: number
  resultsDropped: number
  failed: { cardId: string; error: string }[]
}

/**
 * One background repair pass. Bounded by count AND wall clock.
 *
 * `grade` may be omitted, and then every `regrade` plan degrades to pure
 * carry-forward rather than being skipped — a run with no AI budget still
 * repairs every card whose key points merely got renumbered, which is the
 * common case and the one that silently wipes mastery.
 */
export async function regradeSweep(
  startedAt: number,
  now: () => number,
  grade?: Parameters<typeof regradeCard>[1],
  limit = REGRADE_CARDS_PER_RUN,
): Promise<RegradeSweepResult> {
  const out: RegradeSweepResult = {
    cards: 0,
    answers: 0,
    remapped: 0,
    regraded: 0,
    droppedAll: 0,
    resultsCarried: 0,
    resultsDropped: 0,
    failed: [],
  }

  for (const cardId of await findStrandedCardIds(limit)) {
    if (now() - startedAt >= REGRADE_BUDGET_MS) break
    try {
      const r = await regradeCard(cardId, grade)
      if (!r) continue
      out.cards += 1
      out.answers += r.answers
      out.remapped += r.remapped
      out.regraded += r.regraded
      out.droppedAll += r.droppedAll
      out.resultsCarried += r.resultsCarried
      out.resultsDropped += r.resultsDropped
    } catch (err) {
      // One card's failure must not abandon the sweep. Each card commits its
      // own transaction, so what already succeeded stays repaired and the next
      // run picks this one up again — the queue is a predicate over current
      // state, not a list that can get consumed.
      out.failed.push({ cardId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return out
}
