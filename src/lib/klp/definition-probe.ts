import { STATUS_CREDIT, type KlpStatus } from '@/lib/errors/klp-credit'

/**
 * THE DEFINITION PROBE — the pure half (2026-09-18, owner's ask).
 *
 * The forward acceptance test for a card's key points: grade the card's OWN
 * definition — the owner's vetted, terse answer — as if a learner wrote it.
 * The rebuild test (`rebuild.ts`) asks the inverse question (does an answer
 * built from the points cover the card?); this asks whether the card passes
 * its own points. Measured 2026-09-18 on the ten LBO cards BEFORE this
 * existed: every owner definition scored 19-56/100 against key points
 * authored to a 3-11x longer reference — the authoring prompt had been told
 * to "add what a strong answer needs that the card omits", and the points
 * outgrew the card.
 *
 * Nothing here calls a model or touches Prisma. The thresholds are the
 * owner's ("passable somewhere above 65-ish"; "no card definition should
 * score under 30"), and every decision from a supervisor's closed verdicts
 * is a rule in this file, never the supervisor's opinion of what to do.
 */

/** At or above: the card passes; nothing happens. */
export const DEFINITION_PASS = 0.65
/**
 * Below: no supervision — the points plainly outgrew the card. The card goes
 * straight to revision with the probe's own omissions as findings.
 */
export const DEFINITION_HARD_FAIL = 0.3
/** Supervising passes before a card is escalated to its author. */
export const SUPERVISION_PASSES = 2
/** Probe → revise → re-probe rounds before the card is flagged instead. */
export const MAX_PROBE_ROUNDS = 2

export type ProbeOutcome = 'pass' | 'supervise' | 'hard_fail'

export function probeOutcome(score: number): ProbeOutcome {
  if (score >= DEFINITION_PASS) return 'pass'
  if (score < DEFINITION_HARD_FAIL) return 'hard_fail'
  return 'supervise'
}

export interface ProbeKlp {
  index: number
  text: string
  weight: number
  kind: string
}

export interface ProbeVerdict {
  klpRef: number
  status: string
  quote?: string
}

export interface DefinitionScore {
  /** Weighted credit over every key point, 0-1; an unjudged point counts at zero. */
  score: number
  earned: number
  total: number
  /** Points the definition does not make at all (`omission`), by index. */
  omitted: number[]
  /** Points made only in part (`partial` / `incomplete`), by index. */
  partial: number[]
  /** Points the grader returned no verdict for. */
  unjudged: number[]
  /** Points the grader read as WRONG on the card — the owner must see these. */
  wrong: number[]
}

const PARTIAL: ReadonlySet<string> = new Set(['partial', 'incomplete'])
const WRONG: ReadonlySet<string> = new Set(['contradicted', 'inversion', 'conflation', 'misapplication', 'factual_error', 'overgeneralization', 'failed'])

/**
 * `STATUS_CREDIT` weighted by the card's own weights — the same credit table
 * every reader compares on. `failed` is a hole here as it is everywhere.
 */
export function scoreDefinition(verdicts: readonly ProbeVerdict[], klps: readonly ProbeKlp[]): DefinitionScore {
  const byRef = new Map(verdicts.map((v) => [v.klpRef, v]))
  let earned = 0
  let total = 0
  const omitted: number[] = []
  const partial: number[] = []
  const unjudged: number[] = []
  const wrong: number[] = []
  for (const k of klps) {
    total += k.weight
    const v = byRef.get(k.index)
    if (!v) {
      unjudged.push(k.index)
      continue
    }
    earned += (STATUS_CREDIT[v.status as KlpStatus] ?? 0) * k.weight
    if (v.status === 'omission') omitted.push(k.index)
    else if (PARTIAL.has(v.status)) partial.push(k.index)
    else if (WRONG.has(v.status)) wrong.push(k.index)
  }
  return { score: total > 0 ? earned / total : 0, earned, total, omitted, partial, unjudged, wrong }
}

/**
 * The supervisor's closed vocabulary, one per key point:
 *  - `keep`         the definition genuinely does not make this point; the point is fair.
 *  - `narrow`       the point is the definition's claim expanded past what it says; `wording` is the narrowed point.
 *  - `cut`          the point is not on the card at all.
 *  - `grader_wrong` the definition DOES make this point; the grader's verdict was too harsh.
 */
export const SUPERVISION_VERDICTS = ['keep', 'narrow', 'cut', 'grader_wrong'] as const
export type SupervisionVerdict = (typeof SUPERVISION_VERDICTS)[number]

export interface SupervisionPoint {
  klpRef: number
  verdict: SupervisionVerdict
  reason: string
  /** Required on `narrow`: the point as it should read. */
  wording?: string
}

export type SupervisionDecision = 'revise' | 'grader_wrong' | 'second_pass' | 'escalate'

/**
 * What one supervising pass (or two) adds up to. Any `narrow`/`cut` is a
 * KLP defect → revise. Only `grader_wrong` (and `keep`) → the instrument,
 * not the card, is at fault: logged, not revised. All `keep` → the card is
 * at fault, and one reader is not enough to say so to the author: a second
 * pass on a different model; both holding the card at fault → escalate.
 * Passes are read in order; a second pass naming a defect wins over a first
 * pass that saw none — the author is only bothered when nobody found a
 * defect.
 */
export function supervisionDecision(passes: readonly (readonly SupervisionPoint[])[]): SupervisionDecision {
  if (passes.length === 0) return 'second_pass'
  const all = passes.flat()
  if (all.some((p) => p.verdict === 'narrow' || p.verdict === 'cut')) return 'revise'
  if (all.some((p) => p.verdict === 'grader_wrong')) return 'grader_wrong'
  return passes.length >= SUPERVISION_PASSES ? 'escalate' : 'second_pass'
}

export interface RevisionFinding {
  index: number
  issue: 'over_reach' | 'not_on_card'
  fix: string
}

/** Findings for the writer from a supervisor's `narrow`/`cut` verdicts. */
export function findingsFromSupervision(points: readonly SupervisionPoint[]): RevisionFinding[] {
  const out: RevisionFinding[] = []
  for (const p of points) {
    if (p.verdict === 'narrow') out.push({ index: p.klpRef, issue: 'over_reach', fix: p.wording ? `Narrow to what the definition states: "${p.wording}"` : 'Narrow to what the definition states.' })
    else if (p.verdict === 'cut') out.push({ index: p.klpRef, issue: 'not_on_card', fix: 'Cut: the card does not make this point.' })
  }
  return out
}

/**
 * Findings for a HARD FAIL, from the probe alone: every omitted point is
 * not on the card; every partial point over-reaches it. The definition's
 * text is the only evidence and it is quoted in the fix so the writer reads
 * the card, not the finding.
 */
export function findingsFromHardFail(score: DefinitionScore, klps: readonly ProbeKlp[]): RevisionFinding[] {
  const byIndex = new Map(klps.map((k) => [k.index, k]))
  const out: RevisionFinding[] = []
  for (const i of score.omitted) if (byIndex.has(i)) out.push({ index: i, issue: 'not_on_card', fix: "Cut, or fold into a point the definition does make: the owner's definition does not state this." })
  for (const i of score.partial) if (byIndex.has(i)) out.push({ index: i, issue: 'over_reach', fix: "Narrow to exactly what the owner's definition states about this; no more." })
  return out
}

/** One line per card for the run's table. */
export function formatProbeLine(input: { term: string; score: DefinitionScore; definitionWords: number; referenceWords: number | null; outcome: ProbeOutcome }): string {
  const s = input.score
  const pct = Math.round(s.score * 100)
  const bits = [
    `${String(pct).padStart(3)}/100 ${input.outcome.padEnd(9)}`,
    `def ${String(input.definitionWords).padStart(3)}w`,
    `ref ${input.referenceWords === null ? '  -' : String(input.referenceWords).padStart(3)}w`,
    `omitted ${s.omitted.length ? s.omitted.map((i) => `[${i}]`).join('') : '-'}`,
    `partial ${s.partial.length ? s.partial.map((i) => `[${i}]`).join('') : '-'}`,
    s.wrong.length ? `WRONG ${s.wrong.map((i) => `[${i}]`).join('')}` : '',
    s.unjudged.length ? `unjudged ${s.unjudged.length}` : '',
  ].filter(Boolean)
  return `${bits.join('  ')}  ${input.term.slice(0, 70)}`
}
