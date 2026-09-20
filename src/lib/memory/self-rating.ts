/**
 * The learner's own belief about an answer, captured BEFORE feedback (Spec 6).
 *
 * Ordinal 1-4, never a probability — Spec 7 fits the mapping from data rather
 * than assuming a "3" means 0.75. Prisma-free and client-importable (the same
 * split `roles.ts` makes): the picker, the write path and the readout share
 * this one vocabulary, so a label or a moment cannot drift between them.
 *
 * NULL on the row means "not captured" (toggle off, skipped, or the row
 * predates 2026-09-17). Never 0, never defaulted.
 */
export const SELF_RATINGS = [1, 2, 3, 4] as const
export type SelfRating = (typeof SELF_RATINGS)[number]

export const SELF_RATING_LABELS: Record<SelfRating, string> = {
  1: 'No idea',
  2: 'Unsure',
  3: 'Fairly sure',
  4: 'Certain',
}

/**
 * When the rating was taken. `before_answer` is Review's prospective rating
 * (pre-flip); `after_answer` is the retrospective judgment in quiz and
 * diagnostic (after choosing/typing, before submit). Persisted per row because
 * a prospective 3 and a retrospective 3 are different measurements.
 */
export const SELF_RATING_MOMENTS = ['before_answer', 'after_answer'] as const
export type SelfRatingMoment = (typeof SELF_RATING_MOMENTS)[number]

export function isSelfRating(v: unknown): v is SelfRating {
  return typeof v === 'number' && (SELF_RATINGS as readonly number[]).includes(v)
}

export function isSelfRatingMoment(v: unknown): v is SelfRatingMoment {
  return typeof v === 'string' && (SELF_RATING_MOMENTS as readonly string[]).includes(v)
}
