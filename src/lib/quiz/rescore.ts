import type { Prisma } from '@prisma/client'
import { storedScore } from '@/lib/quiz/scoring'

/** An attempt as `rescoreSetAttempts` reads it: the stored score plus the
 *  scores of the answers that still exist. */
export interface RescoreCandidate {
  id: string
  score: number | null
  answers: { score: number | null }[]
}

/**
 * The pure half of the re-score: which attempts' stored scores no longer match
 * what their SURVIVING answers are worth.
 *
 * Kept free of anything Prisma-shaped (the `Prisma` import below is type-only)
 * so the "which rows changed" decision is testable on plain objects — the same
 * split `erase.ts`/`erase-execute.ts` uses.
 *
 * A `100 -> null` transition IS a change and IS emitted: an attempt that keeps
 * a score after losing every scored answer is the exact defect this exists to
 * prevent. `null -> null` is not a change and is omitted.
 */
export function attemptsNeedingRescore(
  attempts: RescoreCandidate[],
): { id: string; score: number | null }[] {
  const changed: { id: string; score: number | null }[] = []
  for (const attempt of attempts) {
    const next = storedScore(attempt.answers)
    if (next !== attempt.score) changed.push({ id: attempt.id, score: next })
  }
  return changed
}

/** Recomputes every attempt on the set from its SURVIVING answers.
 *
 *  NO userId FILTER. This is the only cross-user memory write in the codebase,
 *  and it is deliberate: sets are link-shareable and `startQuizAttempt` is
 *  readability-scoped, so the OWNER's edit strands OTHER LEARNERS' scores.
 *  There is no privacy cost — each score is derived solely from that user's own
 *  surviving answers, and nothing is read across the boundary. Do not "fix"
 *  this by adding the userId scope every neighbouring function has.
 *
 *  Recomputes EVERY attempt on the set rather than snapshotting the affected
 *  ones: a snapshot must capture attempt ids BEFORE the cascade destroys the
 *  QuizAnswer.cardId link, which makes ordering load-bearing and still loses an
 *  answer committed between snapshot and delete. Recomputing from ground truth
 *  is race-TOLERANT — a concurrent submit derives the same score itself.
 *
 *  KNOWN AND ACCEPTED (decided 2026-08-12): for a MIXED quiz containing a
 *  matching section this can change a score even when the deleted card was
 *  unrelated. `quiz-matching.ts:120` writes a section-scoped formula
 *  unconditionally while MC/SA/TF write the mean, and sections commit in
 *  parallel — so today's stored value is whichever write landed last. The
 *  convergence to mean-of-answers is a fix, not a side effect.
 */
export async function rescoreSetAttempts(
  tx: Prisma.TransactionClient,
  setId: string,
): Promise<void> {
  const attempts = await tx.quizAttempt.findMany({
    where: { setId },
    select: { id: true, score: true, answers: { select: { score: true } } },
  })

  // `score` may be null and null MUST be written — no `if (score !== null)`
  // guard. Skipping it is precisely how an attempt keeps a score after losing
  // all of its evidence.
  for (const { id, score } of attemptsNeedingRescore(attempts)) {
    await tx.quizAttempt.update({ where: { id }, data: { score } })
  }
}
