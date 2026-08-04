import type { StudySource } from '@/lib/memory/scoring'

export const KLP_STATUSES = ['passed', 'partial', 'failed'] as const
export type KlpStatus = (typeof KLP_STATUSES)[number]

/** The categorical judgment, as a fraction. The AI supplies the category. */
export const STATUS_CREDIT: Record<KlpStatus, number> = {
  passed: 1,
  partial: 0.5,
  failed: 0,
}

/**
 * `1 - guessRate`: how much a CORRECT answer in this mode actually proves.
 * Four-option MC can be guessed 1-in-4; true/false is a coin flip.
 */
export const EVIDENCE_STRENGTH: Record<string, number> = {
  'quiz-sa': 0.95,
  'quiz-mc': 0.75,
  'quiz-tf': 0.5,
  matching: 0.75,
  review: 0.8,
  lesson: 0.8,
}

const DEFAULT_STRENGTH = 0.75

/**
 * Graded evidence that a learner holds one KLP, 0-1.
 *
 * The AI never emits this float. It returns `passed | partial | failed` —
 * what a model is actually reliable at — and the mapping plus the mode
 * weighting happen here. Asking a model for a 0-100 score yields values
 * bunched on round numbers: precision that reads as real and is not.
 *
 * A `failed` status is 0 in every mode. Mode weighting discounts CORRECT
 * answers, because an easy mode makes a correct answer weaker evidence. It
 * does not make a WRONG answer weaker evidence — the learner chose it.
 */
export function klpCredit(status: KlpStatus, mode: StudySource): number {
  const base = STATUS_CREDIT[status]
  if (base === 0) return 0
  return base * (EVIDENCE_STRENGTH[mode] ?? DEFAULT_STRENGTH)
}
