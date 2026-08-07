import { DIM_WEIGHTS, type Dimension } from './taxonomy'

/** Multiplier for an error on a card the learner flagged as important. */
export const STAR_BOOST = 1.15

const RELEVANCE_WEIGHT = 0.55
const SEVERITY_WEIGHT = 0.45
const SCALE = 2

export interface SignificanceInput {
  /** CardKlp.weight as of this answer — how central the point is. */
  relevance: number
  /**
   * 1-5. Since Spec 3 this is DERIVED (`resolveSeverity`) from the type's
   * band and the AI-supplied instance `magnitude` — the AI no longer names a
   * severity directly.
   */
  severity: number
  dimension: Dimension
  /** CardProgress.starred at answer time. No progress row means false. */
  starred: boolean
}

export interface SignificanceResult extends SignificanceInput {
  significance: number
}

/**
 * How much this error should weigh in the learner's profile (1-10).
 *
 * `repeatBonus` from the taxonomy is deliberately NOT applied here: it depends
 * on whether the same (type, target) recurs in LATER attempts, which do not
 * exist at write time. Spec 3 adds it at read. Freezing it here would make a
 * tag's score depend on when it happened to be computed.
 *
 * Returns the inputs alongside the result so a stored row can be recomputed if
 * the constants are ever retuned. The derived constants (dimWeight, starBoost)
 * are deliberately NOT returned — they are outputs, and knowing a row used
 * dimWeight 1.0 tells you nothing when recomputing at 0.9.
 */
export function computeSignificance(input: SignificanceInput): SignificanceResult {
  const weighted =
    RELEVANCE_WEIGHT * input.relevance + SEVERITY_WEIGHT * input.severity
  const raw =
    weighted * SCALE * DIM_WEIGHTS[input.dimension] * (input.starred ? STAR_BOOST : 1)

  return { ...input, significance: Math.min(10, Math.max(1, Math.round(raw))) }
}
