import { prisma } from '../src/lib/db'
import { generateText, Output } from 'ai'
import { generateJson } from '../src/lib/ai/generate'
import { resolveLanguageModel, type ProviderId } from '../src/lib/ai/providers'
import {
  readDirectPool,
  nextCombo,
  markTried,
  markExhausted,
  poolStatus,
  type DirectCombo,
} from '../src/lib/klp/direct-pool'
import {
  Pacer,
  RunHaltedError,
  callWithPacingAndRetry,
  realClock,
  rpmToIntervalMs,
  DEFAULT_RPM,
} from '../src/lib/klp/authoring-pacing'
import { GRADE_SHORT_ANSWER_PROMPT } from '../src/lib/ai/prompts/grade-short-answer'
import { regradeCard, type RegradeCardResult } from '../src/lib/klp/regrade-run'
import { summarizeRegrade } from '../src/lib/klp/regrade'
import type { Card } from '@prisma/client'
import type { KlpStatus } from '../src/lib/errors/klp-credit'

/**
 * `npm run regrade-klps` — re-attach stranded learner evidence to a card's
 * current key points.
 *
 * Design: the quality-pipeline spec's revision R1, build order item 2. This is
 * the job that makes every future auto-fix safe, which is why it ships before
 * any check that mutates key points.
 *
 * ## The bug it repairs
 *
 * `writeKlpVersion` supersedes the old `CardKlp` rows and writes new ones with
 * NEW IDS. `AnswerKlpResult` points at the old ids, and `rebuildKlpStates`
 * replays per id — so after any re-authoring the live key points have no
 * evidence and the learner's mastery silently resets to nothing. **A typo fix
 * on a card definition already does this.** Nobody is told; the number just
 * goes back to null.
 *
 * ## What it will and will not do
 *
 * - **Carry forward** any result whose key point survived VERBATIM (whitespace
 *   and case normalised, nothing looser). Free, no AI call, and it covers the
 *   common case where an edit renumbered the points without changing them.
 * - **Re-grade** a free-text answer when the new set has points the carried
 *   evidence does not cover. One AI call per such answer.
 * - **Drop** evidence whose proposition is gone.
 * - **Never infer.** Multiple-choice and true/false are never re-graded at all:
 *   their diagnosis is distractor provenance pinned to a dead version, so
 *   asking a model which new point a wrong pick meant would write a fabricated
 *   observation into a real learner's history.
 * - **Never backfill.** Answers that never had evidence are left alone; this
 *   repairs detachment, it does not invent history.
 *
 * Re-running is safe and cheap: an answer whose evidence is already entirely on
 * live key points is skipped, so the second run over the same card costs
 * nothing. That gate matters because re-grading is NOT deterministic.
 *
 * Flags:
 *   --direct          raw provider keys from the environment, bypassing the encrypted
 *                     credential pool. Needed locally, where `.env` carries no
 *                     `GOOGLE_KEY_ENCRYPTION_SECRET` and every stored credential fails
 *                     to decrypt. Same operator-tool posture as `author-klps`.
 *   --card <cardId>   one card
 *   --set <setId>     every card in a set
 *   --all             every card with stranded evidence (the repair pass)
 *   --no-ai           carry forward only; never spend a grading call
 *   --dry-run         plan and print, write nothing
 *   --limit <n>       cap the cards processed
 */

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

/**
 * The grading seam, wired to the SAME prompt the quiz uses.
 *
 * Deliberately not a new prompt: a re-graded answer has to be comparable to a
 * freshly graded one, and two prompts would drift. `errorTags` are requested by
 * that prompt but discarded here — a re-grade re-establishes which key points
 * the answer supports; re-deriving its error tags would also re-derive their
 * significance under today's constants, silently rewriting the learner's error
 * history as a side effect of a repair.
 */
function grader(userId: string) {
  return async (input: {
    term: string
    definition: string
    answer: string
    klps: { ref: number; text: string; kind: string }[]
  }): Promise<{ klpResults: { klpRef: number; status: KlpStatus; evidence?: string }[] }> => {
    const grade = await generateJson({
      userId,
      task: 'grade',
      prompt: GRADE_SHORT_ANSWER_PROMPT.build({
        card: { term: input.term, definition: input.definition } as Card,
        answer: input.answer,
        klps: input.klps,
      }),
      schema: GRADE_SHORT_ANSWER_PROMPT.schema,
    })
    return { klpResults: (grade.klpResults ?? []) as { klpRef: number; status: KlpStatus }[] }
  }
}

/**
 * `--direct`: the same grading prompt, against raw keys from the environment.
 *
 * Rotates per ANSWER rather than pinning, and that is safe here in a way it is
 * NOT in `author-klps`: a separation score subtracts two candidates' scores, so
 * grading them on different models folds the gap between graders into the
 * number. A re-grade produces one independent verdict set per answer, with no
 * arithmetic across calls, so rotation costs nothing. The model that served
 * each answer is printed.
 */
function directGrader(pool: DirectCombo[], pacer: Pacer) {
  return async (input: {
    term: string
    definition: string
    answer: string
    klps: { ref: number; text: string; kind: string }[]
  }): Promise<{ klpResults: { klpRef: number; status: KlpStatus; evidence?: string }[] }> => {
    for (;;) {
      const combo = nextCombo(pool)
      if (!combo) throw new Error('every key x model combo is out of daily quota')
      markTried(combo, new Date())

      const model = resolveLanguageModel({
        provider: combo.provider as ProviderId,
        apiKey: combo.apiKey,
        model: combo.model,
      })

      try {
        const grade = await callWithPacingAndRetry(
          async () => {
            const res = await generateText({
              model,
              prompt: GRADE_SHORT_ANSWER_PROMPT.build({
                card: { term: input.term, definition: input.definition } as Card,
                answer: input.answer,
                klps: input.klps,
              }),
              output: Output.object({ schema: GRADE_SHORT_ANSWER_PROMPT.schema }),
              // The pacing layer owns retry; two retry authorities multiply.
              maxRetries: 0,
            })
            return res.output
          },
          { pacer, clock: realClock },
        )
        return {
          klpResults: (grade.klpResults ?? []) as { klpRef: number; status: KlpStatus }[],
        }
      } catch (err) {
        if (err instanceof RunHaltedError && err.haltReason === 'daily_quota') {
          markExhausted(combo)
          console.error(`    ${combo.id} out of daily quota; ${poolStatus(pool).available} left`)
          continue
        }
        throw err
      }
    }
  }
}

async function selectCardIds(args: string[]): Promise<string[]> {
  const cardId = opt(args, '--card')
  if (cardId) return [cardId]

  const setId = opt(args, '--set')
  const all = flag(args, '--all')
  if (!setId && !all) return []

  // The work queue, derived: cards holding at least one answer whose evidence
  // sits on a superseded key point. No queue table exists and none is needed —
  // a queue that can drift out of sync with reality is worse than a predicate.
  const rows = await prisma.card.findMany({
    where: {
      ...(setId ? { setId } : {}),
      quizAnswers: { some: { klpResults: { some: { klp: { supersededAt: { not: null } } } } } },
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = flag(args, '--dry-run')
  const noAi = flag(args, '--no-ai')
  const direct = flag(args, '--direct')
  const limitRaw = opt(args, '--limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined

  if (!opt(args, '--card') && !opt(args, '--set') && !flag(args, '--all')) {
    console.error('[regrade-klps] one of --card <id>, --set <id>, or --all is required.')
    process.exitCode = 1
    return
  }

  let cardIds = await selectCardIds(args)
  if (limit !== undefined) cardIds = cardIds.slice(0, limit)

  if (cardIds.length === 0) {
    console.log('[regrade-klps] nothing stranded — every answer\'s evidence is on live key points.')
    return
  }

  console.log(
    `[regrade-klps] ${cardIds.length} card(s) with stranded evidence` +
      `${dryRun ? ' (--dry-run: nothing will be written)' : ''}` +
      `${noAi ? ' (--no-ai: carry-forward only)' : ''}`,
  )

  // One owner resolves the credential pool. The grading call is made on the
  // SET OWNER's credentials, never the answering learner's — a repair is the
  // owner's operation, and billing a learner for a re-grade caused by someone
  // else editing the card would be indefensible.
  const owners = new Map<string, string>()
  const results: RegradeCardResult[] = []

  const pacer = new Pacer(rpmToIntervalMs(DEFAULT_RPM), realClock)
  const pool = direct ? readDirectPool() : []
  if (direct) {
    const status = poolStatus(pool)
    console.log(
      `[regrade-klps] --direct: ${status.total} key x model combo(s), ` +
        `models: ${status.modelsLeft.join(', ')} — bypassing stored credentials`,
    )
  }

  for (const cardId of cardIds) {
    let ownerId = owners.get(cardId)
    if (!ownerId) {
      const card = await prisma.card.findUnique({
        where: { id: cardId },
        select: { set: { select: { userId: true } } },
      })
      ownerId = card?.set.userId
      if (ownerId) owners.set(cardId, ownerId)
    }

    try {
      const result = await regradeCard(
        cardId,
        noAi ? undefined : direct ? directGrader(pool, pacer) : ownerId ? grader(ownerId) : undefined,
        { dryRun },
      )
      if (!result) continue
      results.push(result)
      console.log(
        `  ${cardId} — ${result.answers} answer(s): ` +
          `${result.skipped} skipped, ${result.remapped} remapped, ` +
          `${result.carriedPartial} partial, ${result.droppedAll} dropped, ` +
          `${result.regraded} re-graded (${result.resultsCarried} results carried, ` +
          `${result.resultsDropped} dropped)`,
      )
    } catch (err) {
      // One card's failure must not abandon the rest: each card commits its own
      // transaction, so what already succeeded stays repaired and a re-run picks
      // this one up again — the queue is a predicate over current state.
      console.error(
        `  ${cardId} — FAILED: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const totals = summarizeRegrade(results.flatMap((r) => r.plans))
  console.log()
  console.log(
    `[regrade-klps] done — ${results.length} card(s), ${totals.answers} answer(s): ` +
      `${totals.skipped} skipped, ${totals.remapped} remapped, ${totals.carriedPartial} partial, ` +
      `${totals.droppedAll} dropped-all, ${totals.regraded} re-graded`,
  )
  console.log(
    `[regrade-klps] ${totals.resultsCarried} result(s) carried forward, ` +
      `${totals.resultsDropped} dropped, ${totals.aiCalls} AI call(s)` +
      `${dryRun ? ' WOULD HAVE BEEN made' : ' made'}.`,
  )
  if (totals.resultsDropped > 0) {
    console.log(
      `[regrade-klps] dropped evidence is NOT recoverable and was NOT re-assigned to a ` +
        `neighbouring key point — its proposition no longer exists.`,
    )
  }
}

main()
  .catch((err) => {
    console.error('[regrade-klps] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
