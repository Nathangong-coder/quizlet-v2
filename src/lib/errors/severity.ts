import type { Corruption } from '@/lib/quiz/options'
import type { StudySource } from '@/lib/memory/scoring'

/**
 * How deep a misunderstanding each corruption implies, 1-5.
 *
 * Ranked by what picking it reveals: a conflation or inversion means the
 * concept is misfiled or runs backwards in the learner's model, while a
 * factual_error is a retrieval slip on an otherwise-sound idea.
 */
export const CORRUPTION_SEVERITY: Record<Corruption, number> = {
  conflation: 5,
  inversion: 5,
  misapplication: 4,
  overgeneralization: 3,
  factual_error: 2,
}

/**
 * Severity for a wrong MC/TF pick — no AI call.
 *
 * True/false is docked one point: selecting one of four specific texts is a
 * deliberate choice among named alternatives, while true/false flips a single
 * bit, so the same corruption evidenced by an MC pick says more about THIS
 * learner's model.
 *
 * This is NOT a guess-rate adjustment. Guess rate discounts CORRECT answers,
 * because luck can produce them — that is `EVIDENCE_STRENGTH` in klp-credit.ts.
 * A wrong answer is not luck; the learner actively chose it.
 */
export function severityFromCorruption(
  corruption: Corruption,
  mode: StudySource,
): number {
  const rank = CORRUPTION_SEVERITY[corruption]
  const adjusted = mode === 'quiz-tf' ? rank - 1 : rank
  return Math.min(5, Math.max(1, adjusted))
}
