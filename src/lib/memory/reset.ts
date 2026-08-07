/**
 * The models `resetUserMemory` clears, in delete order.
 *
 * This lives outside `src/actions/user.ts` because that file is `'use server'`,
 * where Next.js permits only async function exports — a `const` there is a
 * build error. Keeping it here also keeps it importable by a test without
 * dragging in `auth` and the Prisma client.
 *
 * `resetUserMemory` maps over this list rather than repeating a hand-written
 * transaction array, so the list is the delete set, not a description of it
 * that can drift out of date.
 *
 * Order is load-bearing at the top: `QuizAttempt` cascades to `QuizAnswer`,
 * which cascades to `AnswerKlpResult`. The explicit `quizAnswer` sweep stays
 * for answers that outlive their attempt, and runs after the cascade.
 *
 * `klpState` is the one entry that is NOT evidence. It is the incremental BKT
 * posterior, and it is not self-correcting: it cannot be stepped backward, and
 * the backfill rebuilds it only from surviving `AnswerKlpResult` rows — so a
 * KLP whose rows this reset just deleted yields no replayed state and is never
 * written back down to the prior. Omitting it here does not merely delay the
 * repair; it makes the stale estimate permanent. Every model added to the
 * reset in future belongs in this list and nowhere else.
 */
export const RESET_MEMORY_MODELS = [
  'quizAttempt',
  'quizAnswer',
  'confidenceEvent',
  'cardProgress',
  'studyEvent',
  'klpState',
] as const;

export type ResetMemoryModel = (typeof RESET_MEMORY_MODELS)[number];
