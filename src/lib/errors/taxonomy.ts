/**
 * The closed error vocabularies from docs/ai/error-taxonomy.md §2.
 *
 * CLOSED is the whole point. A model left to free-form emits `rambling`,
 * `verbose`, `wordy`, `too long` and `unfocused` across five sessions — five
 * rows that should have been one, and the aggregate profile becomes noise.
 * Specificity belongs in the tag's TARGET (which KLP), never in its type.
 */

/** Content correctness. The richest dimension — most predictive signal. */
export const ACCURACY_TYPES = [
  'omission',            // KLP never mentioned
  'incomplete',          // named but not explained
  'conflation',          // described X using Y's content — carries secondaryKlpId
  'inversion',           // direction, sign, or causality reversed
  'misapplication',      // right concept, wrong context
  'factual_error',       // discrete wrong fact, number, or formula term
  'overgeneralization',  // "always"/"never" on a conditional
  'unsupported_leap',    // conclusion does not follow from stated steps
  'fabrication',         // invented mechanism or terminology
] as const

/** Can a listener follow it. */
export const CLARITY_TYPES = [
  'disorganized', 'no_thesis', 'ambiguous_referent',
  'undefined_jargon', 'hedging', 'incoherent_syntax',
] as const

/** Signal per word. Fails in BOTH directions — see `too_terse`. */
export const CONCISENESS_TYPES = [
  'rambling', 'padding', 'redundancy',
  'over_qualification', 'kitchen_sink', 'too_terse',
] as const

export const DIMENSIONS = ['accuracy', 'clarity', 'conciseness'] as const

export type Dimension = (typeof DIMENSIONS)[number]
export type AccuracyType = (typeof ACCURACY_TYPES)[number]
export type ErrorType =
  | AccuracyType
  | (typeof CLARITY_TYPES)[number]
  | (typeof CONCISENESS_TYPES)[number]

/**
 * Interview prep: being wrong is worse than being wordy. Named constants
 * rather than inlined so a different product can retune them, and so
 * significance can be recomputed from stored inputs.
 */
export const DIM_WEIGHTS: Record<Dimension, number> = {
  accuracy: 1.0,
  clarity: 0.8,
  conciseness: 0.7,
}

/** Caps force the model to RANK rather than enumerate. */
export const MAX_TAGS_PER_ANSWER = 4
export const MAX_TAGS_PER_DIMENSION = 2

const BY_DIMENSION: Record<Dimension, readonly string[]> = {
  accuracy: ACCURACY_TYPES,
  clarity: CLARITY_TYPES,
  conciseness: CONCISENESS_TYPES,
}

export function typesForDimension(dimension: Dimension): readonly string[] {
  return BY_DIMENSION[dimension] ?? []
}

/**
 * A type is only valid UNDER ITS OWN DIMENSION. A real type paired with the
 * wrong dimension is rejected: it would otherwise be weighted by a rubric it
 * was never judged against.
 */
export function validateTagType(dimension: Dimension, type: string): boolean {
  return typesForDimension(dimension).includes(type)
}
