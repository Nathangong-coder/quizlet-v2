/**
 * The legacy delete set for a full memory reset, in delete order.
 *
 * NO LONGER read by `resetUserMemory` directly — it is spread into
 * `ERASABLE_MEMORY_MODELS` (src/lib/memory/erase.ts), which adds `studySession`
 * and is what the account erasure scope actually truncates. This list survives
 * as the historical record and as the base of that constant; a test
 * (tests/memory/erase-coverage.test.ts) asserts the newer one covers it.
 *
 * This lives outside `src/actions/user.ts` because that file is `'use server'`,
 * where Next.js permits only async function exports — a `const` there is a
 * build error. Keeping it here also keeps it importable by a test without
 * dragging in `auth` and the Prisma client.
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
 * repair; it makes the stale estimate permanent. A model added to the reset in
 * future belongs in `ERASABLE_MEMORY_MODELS`, not here — this list is closed.
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
