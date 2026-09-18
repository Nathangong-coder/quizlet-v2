import { z } from 'zod'
import { STATUS_CREDIT } from '@/lib/errors/klp-credit'

/**
 * The grader benchmark — Spec 5 §8, scoring half.
 *
 * The KLP traps proved the key points discriminate; this proves the GRADER,
 * reading those key points, ranks answers the way a knowledgeable adversary
 * intended. Same discipline, pointed at the instrument:
 *
 *  - The adversary (`WRITE_GRADER_PANEL_PROMPT`, writer family) writes the
 *    panel and STATES its intent per answer — a level or a failure shape, an
 *    intended rank, and a rationale.
 *  - The runtime grader, exactly as shipped, grades each panel answer IN
 *    ISOLATION — never shown two together. A grader that can see every
 *    answer ranks them against each other and manufactures separation the
 *    key points never earned (`GRADE_CANDIDATES_SEPARATELY`'s lesson,
 *    verbatim). It is never shown the adversary's rationale either.
 *  - TypeScript, here, computes agreement from the grader's CATEGORICAL
 *    verdicts against the adversary's stated intent.
 *
 * NO NUMBER IN THIS MODULE IS AN AI OPINION. Coverage is `STATUS_CREDIT`
 * over the grader's labels; rank agreement is pairwise order; a gap is a
 * subtraction; a shape is a rule over label counts. Every function is pure
 * and takes the persisted `GraderPanelResult` columns (`verdicts`,
 * `relationVerdicts`, `formVerdicts`, `unresolvedQuotes`) plus the answer's
 * `intendedRank` / `mode`, so a re-grade under a new grader is a re-score
 * of the same fixed panel.
 *
 * The panel doubles as Spec 7's cold-start item-parameter source: four
 * answers per card at four levels, graded per key point, is a hit pattern
 * across levels for every key point. That is why the persisted results keep
 * per-KLP verdicts per answer rather than one score.
 */

/** The four competence levels of a `levels` panel, in rank order (rank 1 = `expert`). */
export const GRADER_PANEL_LEVELS = ['expert', 'competent', 'weak', 'wrong'] as const
export type GraderPanelLevel = (typeof GRADER_PANEL_LEVELS)[number]

/** The four failure shapes of a `modes` panel. */
export const GRADER_PANEL_MODES = ['gap', 'misconception', 'connectivity', 'template'] as const
export type GraderPanelMode = (typeof GRADER_PANEL_MODES)[number]

export const GRADER_PANEL_KINDS = ['levels', 'modes', 'blind'] as const
export type GraderPanelKind = (typeof GRADER_PANEL_KINDS)[number]

/**
 * `blind` (2026-09-18, owner's ask) is a levels panel written by an adversary
 * that sees ONLY the question and the reference answer — no key points, no
 * relations, no form requirements — so its answers are shaped like a real
 * learner's prose rather than around the grader's own rubric. It carries the
 * same four levels and is scored by the same rank agreement; only the
 * writer's inputs differ. A panel is "levels-shaped" for scoring when it is
 * either kind.
 */
export function isLevelsKind(kind: GraderPanelKind): boolean {
  return kind === 'levels' || kind === 'blind'
}

/** The shape the scoring rule reads off a graded answer; `none` when no rule fires. */
export type ObservedShape = GraderPanelMode | 'none'

/** One key-point verdict as persisted on `GraderPanelResult.verdicts`, with the point's weight. */
export interface BenchKlpVerdict {
  status: string
  weight: number
}

export interface BenchRelationVerdict {
  status: string
}

export interface BenchFormVerdict {
  status: 'met' | 'not_met' | string
}

/**
 * THE PERSISTED ENTRY SHAPES on `GraderPanelResult` (controller ruling,
 * Task 11). One entry per graded item, keyed BOTH by the prompt ref (what
 * the grader said) and the row id (what it resolves to), with the item's
 * weight at grading time so `coverageScore` is computable from the row
 * alone, and the span TypeScript resolved from the grader's quote — `null`
 * when the quote did not resolve (counted in `unresolvedQuotes`) or no
 * quote was given. The spec's `spans Json` column lives inside these
 * entries rather than beside them: a span without its verdict is nothing.
 */
export interface PanelSpan {
  spanStart: number | null
  spanEnd: number | null
}

export interface PanelKlpVerdict extends PanelSpan {
  klpRef: number
  klpId: string
  status: string
  weight: number
  quote?: string
}

export interface PanelRelationVerdict extends PanelSpan {
  relationRef: number
  relationId: string
  status: string
  quote?: string
}

export interface PanelFormVerdict extends PanelSpan {
  formRef: number
  formRequirementId: string
  status: 'met' | 'not_met'
  quote?: string
}

const SpanColumns = {
  spanStart: z.number().int().nullable(),
  spanEnd: z.number().int().nullable(),
}

export const PanelKlpVerdictSchema = z.object({
  klpRef: z.number().int().min(0),
  klpId: z.string().min(1),
  status: z.string().min(1),
  weight: z.number(),
  quote: z.string().optional(),
  ...SpanColumns,
})

export const PanelRelationVerdictSchema = z.object({
  relationRef: z.number().int().min(0),
  relationId: z.string().min(1),
  status: z.string().min(1),
  quote: z.string().optional(),
  ...SpanColumns,
})

export const PanelFormVerdictSchema = z.object({
  formRef: z.number().int().min(0),
  formRequirementId: z.string().min(1),
  status: z.enum(['met', 'not_met']),
  quote: z.string().optional(),
  ...SpanColumns,
})

/**
 * A live key point the grader returned NO verdict for, with its weight at
 * grading time. Persisted beside the verdicts so `coverageScore` can put it
 * in the denominator from the row alone: a grader that judges one of seven
 * points and gets it right has NOT shown the answer covers the card.
 */
export interface PanelUnjudged {
  klpId: string
  weight: number
}

export const PanelUnjudgedSchema = z.object({
  klpId: z.string().min(1),
  weight: z.number(),
})

/** The three verdict lists of one `GraderPanelResult`, typed, plus what they were graded against. */
export interface PanelResultLists {
  verdicts: PanelKlpVerdict[]
  relationVerdicts: PanelRelationVerdict[]
  formVerdicts: PanelFormVerdict[]
  unresolvedQuotes: number
  /** Live key points in the prompt — `verdicts.length + unjudged.length`. */
  judgedOf: number
  /** The key points with no verdict, at 0 credit in `coverageScore`. */
  unjudged: PanelUnjudged[]
}

/**
 * Reads the `Json` columns of a stored result row into the typed lists.
 * THROWS on a malformed column, naming it: a benchmark that scored a garbled
 * row as zero coverage would report a grader defect that is really a writer
 * defect, and the only writer is `buildPanelVerdicts`. `judgedOf` /
 * `unjudged` are optional on the way in for a row written before the
 * columns existed (none do; the column defaults are 0 / `[]`): such a row is
 * read as "every verdict was judged, nothing missing", which is what the old
 * score assumed.
 */
export function readPanelResult(row: {
  verdicts: unknown
  relationVerdicts: unknown
  formVerdicts: unknown
  unresolvedQuotes: number
  judgedOf?: number | null
  unjudged?: unknown
}): PanelResultLists {
  const read = <T>(name: string, schema: z.ZodType<T>, value: unknown): T[] => {
    const parsed = z.array(schema).safeParse(value)
    if (!parsed.success) {
      throw new Error(`GraderPanelResult.${name} is malformed: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    }
    return parsed.data
  }
  const verdicts = read('verdicts', PanelKlpVerdictSchema, row.verdicts)
  const unjudged = row.unjudged === undefined || row.unjudged === null ? [] : read('unjudged', PanelUnjudgedSchema, row.unjudged)
  const judgedOf = row.judgedOf ? row.judgedOf : verdicts.length + unjudged.length
  return {
    verdicts,
    relationVerdicts: read('relationVerdicts', PanelRelationVerdictSchema, row.relationVerdicts),
    formVerdicts: read('formVerdicts', PanelFormVerdictSchema, row.formVerdicts),
    unresolvedQuotes: row.unresolvedQuotes,
    judgedOf,
    unjudged,
  }
}

/**
 * Converters from the persisted entries to what the scoring functions read.
 * Structurally the persisted entry already satisfies the `Bench*` interface;
 * these exist so a caller narrows deliberately — and so the scoring
 * interfaces can stay minimal when the persisted shape grows.
 */
export function toBenchKlpVerdicts(entries: readonly PanelKlpVerdict[]): (BenchKlpVerdict & { quote?: string })[] {
  return entries.map((e) => ({ status: e.status, weight: e.weight, quote: e.quote }))
}

export function toBenchRelationVerdicts(entries: readonly PanelRelationVerdict[]): (BenchRelationVerdict & { quote?: string })[] {
  return entries.map((e) => ({ status: e.status, quote: e.quote }))
}

export function toBenchFormVerdicts(entries: readonly PanelFormVerdict[]): (BenchFormVerdict & { quote?: string })[] {
  return entries.map((e) => ({ status: e.status, quote: e.quote }))
}

/**
 * Credit-weighted share of the key points the answer holds, in [0, 1].
 * Credit comes from `STATUS_CREDIT` (1 / 0.5 / 0; the legacy `passed` alias
 * reads as 1). A label outside the table is 0, never `NaN` — a benchmark
 * that prints `NaN` for one answer poisons every mean above it.
 *
 * The denominator is the FULL set the answer was graded against: the
 * verdicts the grader returned plus `unjudged`, the live points it returned
 * nothing for, at 0 credit. Without the second list a grader that judged one
 * of seven points and got it right scored 1.0 — the benchmark rewarded
 * silence. A point the grader did not judge is a point the answer has not
 * been shown to hold.
 */
export function coverageScore(
  verdicts: readonly BenchKlpVerdict[],
  unjudged: readonly { weight: number }[] = [],
): number {
  let earned = 0
  let possible = 0
  for (const v of verdicts) {
    const credit = (STATUS_CREDIT as Record<string, number | undefined>)[v.status] ?? 0
    earned += credit * v.weight
    possible += v.weight
  }
  for (const u of unjudged) possible += u.weight
  return possible > 0 ? earned / possible : 0
}

export interface RankedAnswer {
  /** The adversary's stated rank, 1 = best. */
  intendedRank: number
  /** The score TypeScript computed for it — `coverageScore`, typically. */
  score: number
}

export interface RankAgreement {
  agreed: number
  total: number
  /**
   * Every pair the grader got wrong, as `[betterRank, worseRank]` — the pair
   * where the answer the adversary ranked `betterRank` did NOT outscore the
   * one it ranked `worseRank`. Listed in rank order so a report can print
   * the adversary's rationale beside the grader's quotes for each.
   */
  inversions: [number, number][]
}

/**
 * Pairwise rank agreement over every pair of answers with distinct intended
 * ranks (6 pairs for a four-answer panel; 6/6 is perfect). A pair agrees
 * when the better-ranked answer scores STRICTLY higher. A tie is a
 * disagreement: an expert answer and a weak one scoring the same is the
 * grader failing to separate them, whichever way the tie is read.
 */
export function rankAgreement(answers: readonly RankedAnswer[]): RankAgreement {
  const sorted = [...answers].sort((a, b) => a.intendedRank - b.intendedRank)
  let agreed = 0
  let total = 0
  const inversions: [number, number][] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const better = sorted[i]
      const worse = sorted[j]
      if (better.intendedRank === worse.intendedRank) continue
      total++
      if (better.score > worse.score) agreed++
      else inversions.push([better.intendedRank, worse.intendedRank])
    }
  }
  return { agreed, total, inversions }
}

/**
 * Score distance between each adjacent pair of intended levels, in rank
 * order: `[expert − competent, competent − weak, weak − wrong]` for a levels
 * panel. This is where an order that is right by a hair is caught — a
 * panel can score 6/6 on rank agreement with every gap at 0.01. A negative
 * gap is an adjacent inversion.
 */
export function adjacentGaps(answers: readonly RankedAnswer[]): number[] {
  const sorted = [...answers].sort((a, b) => a.intendedRank - b.intendedRank)
  const gaps: number[] = []
  for (let i = 0; i + 1 < sorted.length; i++) gaps.push(sorted[i].score - sorted[i + 1].score)
  return gaps
}

export interface ShapedAnswer {
  /** The failure shape the adversary said it wrote. */
  mode: GraderPanelMode | string
  verdicts: readonly BenchKlpVerdict[]
  relationVerdicts: readonly BenchRelationVerdict[]
  formVerdicts: readonly BenchFormVerdict[]
  /** Key points with no verdict; they lower coverage exactly as in `coverageScore`. */
  unjudged?: readonly { weight: number }[]
}

export interface ShapeAgreement {
  expected: string
  observed: ObservedShape
  agreed: boolean
}

/**
 * Labels that mean the answer holds a WRONG MODEL of the point, as opposed
 * to a hole. `contradicted` is the runtime spelling; `factual_error` is its
 * read-side synonym on older rows; `inversion` is direction reversed.
 */
const WRONG_MODEL_STATUSES: ReadonlySet<string> = new Set(['contradicted', 'factual_error', 'inversion'])

/** KLP coverage at or above this reads as "hits most points" for the template rule. */
export const TEMPLATE_COVERAGE_FLOOR = 0.8

/**
 * Which failure shape the grader's verdicts describe, read as a rule over
 * label counts — never a judgment call.
 *
 * PRECEDENCE, most specific evidence first. The checks are ordered so that
 * when two rules fire, the one naming the more specific failure wins:
 *
 *  1. `misconception` — any key point `contradicted` / `inversion` (or the
 *     legacy `factual_error`). A contradiction is evidence of a wrong model
 *     whatever else is missing, so it beats `gap` when both apply.
 *  2. `connectivity` — every key point at full credit (coverage ≥ 1) but a
 *     relation `omission`. Endpoints right, link never made, can only be
 *     connectivity; it beats `template` because a form failure beside a
 *     perfect content grade says less than the missing link does.
 *  3. `template` — any form requirement `not_met` with key-point coverage at
 *     or above `TEMPLATE_COVERAGE_FLOOR`. This is the template trap's
 *     signature by construction (fluent, hits most points, answers a
 *     neighbouring question), and it beats `gap` because an answer that
 *     covers 80%+ of the content and fails the question's shape is not a
 *     small gap — reading it as one is exactly the failure every content
 *     metric makes.
 *  4. `gap` — `omission` is the dominant non-correct label: at least one
 *     omission, and omissions are at least half of every verdict that is not
 *     `correct` (or the legacy `passed`).
 *  5. `none` — nothing above fired: partials only, or a clean pass.
 */
export function observedShape(answer: Omit<ShapedAnswer, 'mode'>): ObservedShape {
  const { verdicts, relationVerdicts, formVerdicts } = answer

  if (verdicts.some((v) => WRONG_MODEL_STATUSES.has(v.status))) return 'misconception'

  const coverage = coverageScore(verdicts, answer.unjudged ?? [])
  if (coverage >= 1 && verdicts.length > 0 && relationVerdicts.some((r) => r.status === 'omission')) return 'connectivity'

  if (coverage >= TEMPLATE_COVERAGE_FLOOR && formVerdicts.some((f) => f.status === 'not_met')) return 'template'

  let omissions = 0
  let nonCorrect = 0
  for (const v of verdicts) {
    if (v.status === 'correct' || v.status === 'passed') continue
    nonCorrect++
    if (v.status === 'omission') omissions++
  }
  if (omissions > 0 && omissions * 2 >= nonCorrect) return 'gap'

  return 'none'
}

/**
 * Does the grader's read of a `modes` panel answer match the shape the
 * adversary wrote? `expected` is the adversary's word, `observed` is the
 * rule above. Aggregated over a panel these form a confusion matrix over
 * shapes; a disagreement is reported with both names, never collapsed to a
 * boolean, because "the gap answer read as a misconception" and "the gap
 * answer read as nothing" are different grader defects.
 */
export function shapeAgreement(answer: ShapedAnswer): ShapeAgreement {
  const observed = observedShape(answer)
  return { expected: answer.mode, observed, agreed: observed === answer.mode }
}

/** The persisted verdict lists, as far as the quote rate needs them. */
export interface QuotedResult {
  unresolvedQuotes: number
  verdicts: readonly { quote?: string | null }[]
  relationVerdicts: readonly { quote?: string | null }[]
  formVerdicts: readonly { quote?: string | null }[]
}

export interface UnresolvedQuoteRate {
  unresolved: number
  quotes: number
  /** `unresolved / quotes`; 0 when the grader wrote no quotes. */
  rate: number
}

/**
 * The share of the grader's quotes that did not resolve to a span of the
 * answer (`src/lib/analysis/spans.ts`). An unresolved quote is the model
 * paraphrasing where it was told to quote verbatim — a grader-quality
 * number, not a learner one. The denominator is every non-empty `quote`
 * across all three verdict lists, so the rate is computable from the
 * persisted row alone.
 */
export function unresolvedQuoteRate(results: readonly QuotedResult[]): UnresolvedQuoteRate {
  let unresolved = 0
  let quotes = 0
  for (const r of results) {
    unresolved += r.unresolvedQuotes
    for (const list of [r.verdicts, r.relationVerdicts, r.formVerdicts]) {
      for (const v of list) if (typeof v.quote === 'string' && v.quote.length > 0) quotes++
    }
  }
  return { unresolved, quotes, rate: quotes > 0 ? unresolved / quotes : 0 }
}
