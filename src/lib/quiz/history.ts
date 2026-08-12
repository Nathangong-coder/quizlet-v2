import type { Prisma } from '@prisma/client'

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
 *   - src/lib/metrics/read.ts   the repeatBonus attempt window
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
