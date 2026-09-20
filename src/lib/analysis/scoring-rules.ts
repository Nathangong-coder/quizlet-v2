import { STATUS_CREDIT } from '@/lib/errors/klp-credit'
import type { BenchKlpVerdict, BenchRelationVerdict } from '@/lib/analysis/benchmark'

/**
 * THE GRADER'S TUNING KNOBS (2026-09-18, owner's ask). Everything here is
 * TypeScript over persisted verdicts, so a change re-scores every stored
 * benchmark result in seconds with no AI call — `npm run bench-grader`'s
 * report is the readout.
 *
 * Why a contradiction term exists: `coverageScore` treats a contradicted
 * point exactly like a missing one (credit 0), so a confidently WRONG answer
 * that states every other point out-scores a thin answer with three holes.
 * On the LBO baseline the "walk me through an LBO" wrong answer — which
 * inverts the debt-paydown mechanism and five relations that hang off it —
 * scored 0.75 coverage. The owner's read: "egregiously wrong, should be 0.3
 * or less". A hole is not knowing; a contradiction is knowing the wrong
 * thing, and the second must cost more than the first.
 *
 * Measured against the stored LBO results before choosing the defaults:
 * every non-zero penalty fixed both wrong-over-weak inversions (56/60 →
 * 58/60; the two that remain are expert/competent ties no scoring rule can
 * touch); `contradictionPenalty` 1 with `relationContradictionPenalty` 0.5
 * put that answer at 0.22 while leaving every "weak" score (no
 * contradictions) untouched. Relation penalties at 1.0 zeroed every wrong
 * answer — too blunt to keep any gradation among them.
 *
 * `coverage` (holes only) is still reported beside `score` (with the
 * contradiction term) so "what did they cover" and "how wrong were they"
 * stay readable as two things — never a composite the owner cannot unpick.
 */
export interface GraderScoringRules {
  /** A contradicted / inverted / conflated / misapplied point SUBTRACTS this × its weight. 0 = the old coverage rule. */
  contradictionPenalty: number
  /** A contradicted relation subtracts this × the card's mean key-point weight (relations carry no weight of their own). */
  relationContradictionPenalty: number
}

export const GRADER_SCORING: GraderScoringRules = {
  contradictionPenalty: 1.0,
  relationContradictionPenalty: 0.5,
}

/**
 * The statuses that mean "the answer asserted something false about this
 * point" as opposed to "did not say it". `omission`, `partial`,
 * `incomplete` and `failed` are holes; these are wrong models. `failed` is
 * the grader's honest fallback and is NOT treated as a contradiction —
 * penalising it would punish the grader's uncertainty, not the learner's.
 */
export const CONTRADICTION_STATUSES: ReadonlySet<string> = new Set([
  'contradicted',
  'inversion',
  'conflation',
  'misapplication',
  'factual_error',
  'overgeneralization',
])

export function isContradiction(status: string): boolean {
  return CONTRADICTION_STATUSES.has(status)
}

/**
 * Coverage minus the contradiction term, floored at 0. `possible` is the
 * weight of every key point the answer was graded against (judged and
 * unjudged), the same denominator `coverageScore` uses.
 */
export function answerScore(
  verdicts: readonly BenchKlpVerdict[],
  relationVerdicts: readonly BenchRelationVerdict[],
  unjudged: readonly { weight: number }[] = [],
  rules: GraderScoringRules = GRADER_SCORING,
): number {
  let earned = 0
  let possible = 0
  for (const v of verdicts) {
    possible += v.weight
    if (isContradiction(v.status)) earned -= rules.contradictionPenalty * v.weight
    else earned += ((STATUS_CREDIT as Record<string, number | undefined>)[v.status] ?? 0) * v.weight
  }
  for (const u of unjudged) possible += u.weight
  const judgedCount = verdicts.length + unjudged.length
  const meanWeight = judgedCount > 0 ? possible / judgedCount : 0
  for (const r of relationVerdicts) {
    if (isContradiction(r.status)) earned -= rules.relationContradictionPenalty * meanWeight
  }
  if (possible <= 0) return 0
  return Math.max(0, earned / possible)
}

/**
 * The composition axis: how an answer failed, as counts. Reported beside the
 * score, never folded into it — two answers at the same score with different
 * compositions need opposite fixes (the owner's grader design).
 */
export interface VerdictComposition {
  correct: number
  partial: number
  missing: number
  wrong: number
  relationsWrong: number
  relationsMissing: number
}

export function compositionOf(
  verdicts: readonly BenchKlpVerdict[],
  relationVerdicts: readonly BenchRelationVerdict[] = [],
  unjudged: readonly unknown[] = [],
): VerdictComposition {
  const c: VerdictComposition = { correct: 0, partial: 0, missing: unjudged.length, wrong: 0, relationsWrong: 0, relationsMissing: 0 }
  for (const v of verdicts) {
    if (isContradiction(v.status)) c.wrong++
    else {
      const credit = (STATUS_CREDIT as Record<string, number | undefined>)[v.status] ?? 0
      if (credit >= 1) c.correct++
      else if (credit > 0) c.partial++
      else c.missing++
    }
  }
  for (const r of relationVerdicts) {
    if (isContradiction(r.status)) c.relationsWrong++
    else if (((STATUS_CREDIT as Record<string, number | undefined>)[r.status] ?? 0) < 1) c.relationsMissing++
  }
  return c
}
