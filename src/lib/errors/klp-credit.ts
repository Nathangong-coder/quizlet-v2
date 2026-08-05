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
 *
 * Only the three modes Spec 2a actually grades against a KLP. `klpCredit`'s
 * `mode` parameter is typed as the full `StudySource` (review/matching/lesson
 * included) because that's what `AnswerKlpResult.mode` and the callers it
 * flows through are typed as — but this map intentionally does NOT carry an
 * entry for those three: nothing calls `klpCredit` with them today, and a
 * guessed number for a mode nobody has reasoned about would be worse than no
 * number at all. `DEFAULT_STRENGTH` covers them if that ever changes.
 */
export const EVIDENCE_STRENGTH: Record<string, number> = {
  'quiz-sa': 0.95,
  'quiz-mc': 0.75,
  'quiz-tf': 0.5,
}

/**
 * Fallback for any `StudySource` not in `EVIDENCE_STRENGTH` above. Matches
 * `quiz-mc`'s strength as a middle-of-the-road placeholder — deliberately NOT
 * pinned to a specific guess-rate rationale, because none exists yet for
 * review/matching/lesson evidence. Revisit when one of those modes actually
 * starts crediting KLPs.
 */
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
