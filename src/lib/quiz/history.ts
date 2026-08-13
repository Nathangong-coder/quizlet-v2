import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * An attempt with no answers is not a study record. Two of the four
 * populations that produce one (skipped, abandoned) are hidden by this
 * predicate rather than deleted, so nothing is destroyed if the rule is wrong.
 *
 * DO NOT SPREAD THIS EVERYWHERE. The risk here is INVERTED from
 * `readableSetWhere` (src/lib/sets/visibility.ts): there, a forgotten guard
 * leaked data, so over-applying was free. Here, over-applying is the dangerous
 * direction — an IN-FLIGHT attempt has zero answers until the first submit.
 *
 * Correct call sites (2, both read-only history surfaces):
 *   - src/actions/user.ts   getUserStats
 *   - `loadAnsweredAttemptIds` below, which is the repeatBonus attempt window
 *     for BOTH of its callers (metrics/read.ts and the quiz results screen)
 *
 * Call sites that must NEVER filter:
 *   - src/actions/quiz.ts, src/actions/quiz-matching.ts — in-flight lookups.
 *     Filtering breaks the FIRST QUESTION OF EVERY QUIZ.
 *   - src/app/sets/[id]/print/page.tsx — printable attempts are zero-answer
 *     by design.
 *   - src/lib/memory/erase-execute.ts — erasure must see what it is erasing.
 */
export const ANSWERED_ATTEMPT_WHERE = {
  answers: { some: {} },
} satisfies Prisma.QuizAttemptWhereInput

/**
 * The learner's real attempt sequence for `repeatBonus`: every ANSWERED
 * attempt, oldest first.
 *
 * One function rather than the same query in two files, because the two
 * callers — `getLearnerMetrics` and `getQuizAttemptSummary` — must agree
 * EXACTLY. `repeatBonus` is positional ("within the last N attempts"), so if
 * one of them counts abandoned attempts and the other does not, the same tag
 * scores differently on the dashboard and on the results screen, which is the
 * disagreement Spec 3B §3.4 exists to prevent. Two copies of a query that must
 * not diverge is how they diverge.
 *
 * Deliberately UNSCOPED beyond the user: a clean sitting is exactly what has to
 * be visible, and narrowing by set or category would make the same tag's
 * significance depend on which view is asking.
 *
 * Safe for the tag join in both callers: every error tag reaches an attempt
 * through `quizAnswer.attemptId`, so any attempt a tag references has >= 1
 * answer by construction and cannot be filtered away here.
 */
export async function loadAnsweredAttemptIds(
  prisma: PrismaClient,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.quizAttempt.findMany({
    where: { userId, ...ANSWERED_ATTEMPT_WHERE },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}
