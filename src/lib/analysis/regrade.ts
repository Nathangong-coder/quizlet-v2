import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { ShortAnswerGradeSchema, ShortAnswerGradeWithAnalysisSchema, type ShortAnswerGrade } from '@/lib/ai/schemas'
import { ANALYSIS_VERSION, buildAnalysisWrites, type AnalysisOutcome, type ErrorTagDraft } from '@/lib/analysis/persist'
import { GRADER_VERSION } from '@/lib/analysis/version'
import { gradeMaxOutputTokens } from '@/lib/analysis/output-cap'
import { ANALYSIS_TX_OPTIONS, writeAnalysisGeneration } from '@/lib/analysis/write-answer'
import { loadGradingContext, promptViewOf } from '@/lib/quiz/grading-context'
import { toStudySource } from '@/lib/quiz/mode'
import { lockKlpStates, rebuildKlpStates } from '@/lib/metrics/state-writer'

/**
 * The GRADER-VERSION regrade (Spec 5 Phase A §6).
 *
 * Same answer, same key points, a NEW instrument: `GRADER_VERSION` moved
 * because the content prompt, the span resolver or the lexicon changed, and
 * "grader changes are recoverable by re-grading" is only true once something
 * can re-run the grader over stored answers. This writes a new GENERATION of
 * analysis rows stamped with the current version and marks the old
 * generation `supersededAt` — the versioning discipline `CardKlp` uses. It
 * never deletes: the old rows are the record of what the old grader said,
 * and the benchmark that justified the version bump reads them.
 *
 * NOT the KLP-EDIT regrade. `src/lib/klp/regrade-run.ts` moves evidence after
 * a card's POINTS change (carry by exact text, drop, or re-grade) and
 * rewrites rows in place. That job answers "which propositions does this
 * answer's evidence attach to?"; this one answers "what does the current
 * grader say about the same propositions?". They share the row writer
 * (`writeAnalysisGeneration`) and nothing else — two planners, because the
 * skip rules and the write semantics differ.
 *
 * Two rules from that sibling carry over unchanged:
 *
 * - **No AI call inside the transaction.** The grade is fetched first; the
 *   transaction opens only once there is something to write.
 * - **Replay over the UNION of old and new key points.** A key point in the
 *   superseded generation only would otherwise keep a posterior built from a
 *   row nothing reads any more.
 */

/** What the planner needs to know about one stored answer. Prisma-free. */
export interface RegradeCandidate {
  id: string
  /** `QuizAnswer.mode` — the quiz vocabulary ('short-answer'), not StudySource. */
  mode: string
  graderVersion: number | null
  answerText: string | null
  /** Live `CardKlp` rows on the card. Zero means nothing to grade against. */
  liveKlpCount: number
  /**
   * The card's term side carries a non-text block. The regrade builds the
   * TEXT prompt only; a media card graded without its media would be a
   * worse verdict than the one it already has.
   */
  hasMediaPrompt?: boolean
  /**
   * At least one LIVE row of this answer points at a superseded `CardKlp` —
   * the answer is stranded on an old key-point version. That is the KLP-edit
   * regrade's job (`npm run regrade-klps`), not this tool's: see
   * `klps_superseded`.
   */
  liveRowsPointAtSupersededKlp?: boolean
}

export type RegradeSkipReason =
  | 'current_version'
  | 'no_answer_text'
  | 'no_live_klps'
  | 'not_short_answer'
  | 'media_prompt'
  | 'klps_superseded'

export interface PlanRegradeOptions {
  graderVersion: number
  /**
   * `--include-stranded`: grade an answer whose rows point at a superseded
   * key-point version anyway, against the LIVE version. Off by default —
   * see `klps_superseded`.
   */
  includeStranded?: boolean
}

export interface RegradePlan {
  toGrade: string[]
  skipped: { id: string; reason: RegradeSkipReason }[]
}

/** The one reason an answer is skipped, or null when it should be graded. */
export function skipReasonFor(
  a: RegradeCandidate,
  opts: PlanRegradeOptions,
): RegradeSkipReason | null {
  // Order is the order of cheapness to explain: a current row is the
  // resumability gate and the most common skip on a second run.
  if (a.graderVersion !== null && a.graderVersion >= opts.graderVersion) return 'current_version'
  if (a.mode !== 'short-answer') return 'not_short_answer'
  if (!a.answerText || a.answerText.trim().length === 0) return 'no_answer_text'
  if (a.liveKlpCount === 0) return 'no_live_klps'
  if (a.hasMediaPrompt) return 'media_prompt'
  if (a.liveRowsPointAtSupersededKlp && !opts.includeStranded) return 'klps_superseded'
  return null
}

/**
 * Decides which answers a run grades. Pure.
 *
 * - `current_version`: already at (or past) the target `graderVersion`. This
 *   is what makes a run RESUMABLE — re-grading is not deterministic, so a
 *   second pass over finished rows would churn every posterior for nothing.
 * - `not_short_answer`: MC/TF diagnosis is distractor provenance, not text.
 *   The same rule the KLP-edit regrade enforces (`REGRADABLE_MODES`).
 * - `no_answer_text`: nothing to grade.
 * - `no_live_klps`: nothing to grade AGAINST — the content pass is per point.
 * - `media_prompt`: see `RegradeCandidate.hasMediaPrompt`.
 * - `klps_superseded`: the answer's live rows point at a superseded key-point
 *   version. This tool re-measures the SAME key points under a new
 *   instrument; re-attaching evidence to a NEW version is the KLP-edit
 *   regrade's job, and folding the two into one run would make one number
 *   carry two different changes. `includeStranded` overrides (the script's
 *   `--include-stranded`), grading against the live version.
 */
export function planRegrade(
  answers: RegradeCandidate[],
  opts: PlanRegradeOptions,
): RegradePlan {
  const toGrade: string[] = []
  const skipped: RegradePlan['skipped'] = []
  for (const a of answers) {
    const reason = skipReasonFor(a, opts)
    if (reason) skipped.push({ id: a.id, reason })
    else toGrade.push(a.id)
  }
  return { toGrade, skipped }
}

/** What the script's generator receives. The prompt is already built. */
export interface RegradeGenInput {
  prompt: string
  /** `ShortAnswerGradeWithAnalysisSchema` — a regrade always lists key points. */
  schema: typeof ShortAnswerGradeWithAnalysisSchema
  /** The fluid ceiling (`gradeMaxOutputTokens`) for this card's item count. */
  maxOutputTokens: number
}

/**
 * The AI seam. Injected so the module never chooses credentials: the script
 * decides between the set owner's stored pool and `--direct` env keys, and a
 * test hands in a fake. Returns the parsed grade and the model that served it.
 */
export type RegradeGenerator = (
  input: RegradeGenInput,
) => Promise<{ value: ShortAnswerGrade; model: string | null }>

export type RegradeAnswerResult =
  | { answerId: string; outcome: 'skipped'; reason: RegradeSkipReason }
  | {
      answerId: string
      outcome: 'regraded'
      status: AnalysisOutcome
      model: string | null
      /** Rows in the superseded generation, per table. */
      superseded: number
      written: {
        klpResults: number
        errorTags: number
        relationResults: number
        formResults: number
        unwarranted: number
      }
      warnings: { reason: string; value: string }[]
    }

const answerSelect = {
  id: true,
  userId: true,
  cardId: true,
  mode: true,
  answer: true,
  createdAt: true,
  graderVersion: true,
  card: {
    select: {
      id: true,
      term: true,
      definition: true,
      contentBlocks: { select: { side: true, type: true } },
    },
  },
  // The live generation's key points, for the `klps_superseded` rule.
  klpResults: { where: { supersededAt: null }, select: { klp: { select: { supersededAt: true } } } },
} satisfies Prisma.QuizAnswerSelect

/**
 * Re-grades ONE stored short answer under the current `GRADER_VERSION`.
 *
 * Reads the same inputs the quiz reads for a fresh grade — the card, its
 * live key points (`supersededAt: null`, index order: the `ensureKlpsReady`
 * read without the extraction trigger), `loadGradingContext` for relations,
 * form requirements and the reference, the learner's starred flag — and
 * builds the same v5 prompt through `GRADE_SHORT_ANSWER_PROMPT.build` with
 * `promptViewOf`. Nothing about the learner rides in: the grader is a
 * stateless instrument (Spec 5, "The boundary").
 *
 * Against the card's LIVE key points — and ONLY when the answer's live rows
 * already point at them. An answer stranded on a superseded `CardKlp`
 * version is skipped (`klps_superseded`): re-attaching evidence to a new
 * version is `regrade-klps`'s job, and this tool's whole claim is that it
 * changes the instrument and nothing else. `includeStranded` (the script's
 * `--include-stranded`) overrides, grading against the live version — the
 * same verdict `regrade-klps` would produce for short answer, one run earlier.
 *
 * Then, in ONE transaction: every live row of this answer in all five
 * analysis tables is marked `supersededAt = now`, the new generation is
 * written through `writeAnalysisGeneration` at the answer's own `createdAt`,
 * the answer is stamped (`graderVersion`, `analysisVersion`, `analysisStatus`,
 * `analysisWarnings`, `regradedAt`), and `KlpState` is replayed for the union
 * of superseded and new key points — through `rebuildKlpStates`, which reads
 * live rows only, so the posterior reflects exactly one generation.
 *
 * NOT touched: `QuizAnswer.grade` (the rubric blob shown on the results
 * page), `score`, `isCorrect`, `feedback`, and the `StudyEvent` behind them.
 * Those are what the learner SAW and what stepped their confidence; a regrade
 * re-measures the analysis rows the metrics read, it does not rewrite the
 * session the learner sat. The blob's own `klpResults` are therefore the old
 * grader's; the rows are the new one's, and rows are what every reader uses.
 */
export async function regradeAnswer(
  answerId: string,
  gen: RegradeGenerator,
  opts: { now?: () => Date; includeStranded?: boolean } = {},
): Promise<RegradeAnswerResult> {
  const answer = await prisma.quizAnswer.findUnique({ where: { id: answerId }, select: answerSelect })
  if (!answer) throw new Error(`regrade: answer ${answerId} not found`)

  const klps = await prisma.cardKlp.findMany({
    where: { cardId: answer.cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, text: true, weight: true, kind: true, version: true },
  })

  const reason = skipReasonFor(
    {
      id: answer.id,
      mode: answer.mode,
      graderVersion: answer.graderVersion,
      answerText: answer.answer,
      liveKlpCount: klps.length,
      hasMediaPrompt: answer.card.contentBlocks.some((b) => b.side === 'term' && b.type !== 'text'),
      liveRowsPointAtSupersededKlp: answer.klpResults.some((r) => r.klp.supersededAt !== null),
    },
    { graderVersion: GRADER_VERSION, includeStranded: opts.includeStranded },
  )
  if (reason) return { answerId, outcome: 'skipped', reason }
  const answerText = answer.answer as string

  // The prompt takes a `Card`; the three fields it reads are loaded above,
  // and a full-row read here would only be for the type.
  const card = await prisma.card.findUnique({ where: { id: answer.cardId } })
  if (!card) throw new Error(`regrade: card ${answer.cardId} not found`)

  // `starred` is an input to significance. It is copied from the superseded
  // generation's tags when there are any — `AnswerErrorTag.starred` is
  // "starred AT ANSWER TIME" — so a regrade measures the grader alone: a card
  // the learner starred since must not move every tag's significance for a
  // reason that has nothing to do with the instrument. Only an answer whose
  // prior generation carried no tags falls back to current progress.
  const priorTag = await prisma.answerErrorTag.findFirst({
    where: { quizAnswerId: answerId, supersededAt: null },
    select: { starred: true },
  })
  const progress = priorTag
    ? null
    : await prisma.cardProgress.findUnique({
        where: { userId_cardId: { userId: answer.userId, cardId: answer.cardId } },
        select: { starred: true },
      })
  const starred = priorTag?.starred ?? progress?.starred ?? false

  const promptKlps = klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind }))
  const context = await loadGradingContext(answer.cardId, klps)
  const { promptRelations, promptFormReqs } = promptViewOf(klps, context)
  const prompt = GRADE_SHORT_ANSWER_PROMPT.build({
    card,
    answer: answerText,
    klps: promptKlps,
    relations: promptRelations.length > 0 ? promptRelations : undefined,
    formReqs: promptFormReqs.length > 0 ? promptFormReqs : undefined,
    referenceAnswer: context.referenceAnswer ?? undefined,
  })
  const maxOutputTokens = gradeMaxOutputTokens(
    promptKlps.length + promptRelations.length + promptFormReqs.length,
  )

  // OUTSIDE the transaction — see the header.
  const { value: grade, model } = await gen({ prompt, schema: ShortAnswerGradeWithAnalysisSchema, maxOutputTokens })

  // Same rule as submitShortAnswer: no per-point verdicts on a card that has
  // points is the grader not doing the job, never a clean grade.
  const forcedStatus =
    klps.length > 0 && (grade.klpResults ?? []).length === 0 ? ('no_provenance' as const) : undefined

  const writes = buildAnalysisWrites({
    mode: toStudySource('short-answer'),
    klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
    starred,
    klpResults: grade.klpResults ?? [],
    errorTags: (grade.errorTags ?? []) as ErrorTagDraft[],
    answerText,
    relations: context.relations,
    formReqs: context.formReqs,
    relationResults: grade.relationResults ?? [],
    formResults: grade.formResults ?? [],
    unwarranted: grade.unwarranted ?? [],
    forcedStatus,
  })

  const now = (opts.now ?? (() => new Date()))()

  const superseded = await prisma.$transaction(async (tx) => {
    // Which key points the LIVE generation touches — read before it is
    // superseded, because afterwards nothing distinguishes it from history.
    const old = await tx.answerKlpResult.findMany({
      where: { quizAnswerId: answerId, supersededAt: null },
      select: { klpId: true },
    })
    const affected = [...new Set([...old.map((r) => r.klpId), ...writes.klpResults.map((r) => r.klpId)])]

    // Before any posterior read; covers the rebuild below.
    await lockKlpStates(tx, answer.userId, affected)

    // Supersede — every table, live rows only, one clock. Never a delete.
    // Sequential on purpose: an interactive transaction runs on one
    // connection, so fanning these out buys nothing and reads worse.
    const live = { quizAnswerId: answerId, supersededAt: null }
    const data = { supersededAt: now }
    let supersededRows = 0
    supersededRows += (await tx.answerKlpResult.updateMany({ where: live, data })).count
    supersededRows += (await tx.answerErrorTag.updateMany({ where: live, data })).count
    supersededRows += (await tx.answerRelationResult.updateMany({ where: live, data })).count
    supersededRows += (await tx.answerFormResult.updateMany({ where: live, data })).count
    supersededRows += (await tx.answerUnwarrantedClaim.updateMany({ where: live, data })).count

    // The new generation, at the answer's own clock (see writeAnalysisGeneration).
    await writeAnalysisGeneration(tx, answerId, writes, { createdAt: answer.createdAt })

    await tx.quizAnswer.update({
      where: { id: answerId },
      data: {
        analysisStatus: writes.status,
        analysisVersion: ANALYSIS_VERSION,
        graderVersion: GRADER_VERSION,
        analysisWarnings:
          writes.warnings.length > 0 ? (writes.warnings as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        regradedAt: now,
      },
    })

    // LAST. Replays each affected posterior from the live generation only.
    await rebuildKlpStates(tx, answer.userId, affected)

    return supersededRows
  }, ANALYSIS_TX_OPTIONS)

  return {
    answerId,
    outcome: 'regraded',
    status: writes.status,
    model,
    superseded,
    written: {
      klpResults: writes.klpResults.length,
      errorTags: writes.errorTags.length,
      relationResults: writes.relationResults.length,
      formResults: writes.formResults.length,
      unwarranted: writes.unwarranted.length,
    },
    warnings: writes.warnings,
  }
}

/**
 * Loads the planner's view of every short answer a scope reaches, oldest
 * first. The script's read; kept here so the candidate shape and the
 * `regradeAnswer` skip rules cannot drift apart (both go through
 * `skipReasonFor`).
 */
export async function loadRegradeCandidates(
  scope: { setId: string } | { attemptId: string },
): Promise<RegradeCandidate[]> {
  const rows = await prisma.quizAnswer.findMany({
    where: 'setId' in scope ? { card: { setId: scope.setId } } : { attemptId: scope.attemptId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      mode: true,
      graderVersion: true,
      answer: true,
      card: {
        select: {
          klps: { where: { supersededAt: null }, select: { id: true } },
          contentBlocks: { select: { side: true, type: true } },
        },
      },
      klpResults: { where: { supersededAt: null }, select: { klp: { select: { supersededAt: true } } } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    mode: r.mode,
    graderVersion: r.graderVersion,
    answerText: r.answer,
    liveKlpCount: r.card.klps.length,
    hasMediaPrompt: r.card.contentBlocks.some((b) => b.side === 'term' && b.type !== 'text'),
    liveRowsPointAtSupersededKlp: r.klpResults.some((x) => x.klp.supersededAt !== null),
  }))
}
