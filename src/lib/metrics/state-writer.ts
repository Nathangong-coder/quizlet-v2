import type { Prisma } from '@prisma/client'
import { nextKlpState, rebuildStatesFromResults, type KlpStateRow } from '@/lib/metrics/cache'
import type { KlpStatus } from '@/lib/errors/klp-credit'
import type { StudySource } from '@/lib/memory/scoring'

/** The part of an `AnswerKlpResult` write that BKT reads. */
export interface KlpObservationWrite {
  klpId: string
  status: KlpStatus
  mode: StudySource
}

/**
 * Step every `KlpState` an answer touched forward by one observation.
 *
 * Takes `load`/`save` closures rather than a Prisma client so the ordering
 * rules below are unit-testable without a database — this suite has no
 * DB-mocking precedent, and the rules are exactly what was missing in
 * production: `KlpState` had a reader and no writer at all, so every topic's
 * knowledge read null forever and `computeArticulation` booked every
 * `too_terse` as a knowledge gap.
 *
 * SEQUENTIAL, deliberately. Two results naming the same KLP in one answer must
 * compose into two observations; running them concurrently would have both
 * read the same pre-state and the second write would discard the first.
 * Callers pass closures bound to their transaction, so the states and the
 * `AnswerKlpResult` rows behind them commit together.
 */
export async function persistKlpStates(input: {
  userId: string
  results: KlpObservationWrite[]
  /** The answer's own createdAt, so this clock matches the replayable one. */
  observedAt: Date
  load: (klpId: string) => Promise<KlpStateRow | null>
  save: (state: KlpStateRow) => Promise<void>
}): Promise<void> {
  for (const r of input.results) {
    const existing = await input.load(r.klpId)
    const next = nextKlpState(existing, input.userId, r.klpId, {
      status: r.status,
      mode: r.mode,
      createdAt: input.observedAt,
    })
    await input.save(next)
  }
}

/**
 * The client `rebuildKlpStates` writes through.
 *
 * `Prisma.TransactionClient` (a type-only import — nothing from Prisma exists
 * at runtime in this module) rather than a hand-rolled structural shape. A
 * structural `{ findMany(args: unknown) }` does not accept Prisma's generic,
 * `SelectSubset`-constrained delegate methods, and the tempting repair — widen
 * the args to `any` — would also silently accept the base `prisma` client,
 * which is precisely the mistake this function exists to prevent: a rebuild
 * that runs outside the transaction reintroduces the torn-write half of the
 * defect. Structural typing cannot fully forbid that (`TransactionClient` is an
 * `Omit` of `PrismaClient`, so the base client remains assignable), so the
 * guarantee is pinned by a test that asserts the rebuild's read is issued
 * against the transaction client before commit, not by the type alone.
 */
export type KlpRebuildTx = Prisma.TransactionClient

/**
 * Recompute state for specific KLPs from surviving history.
 *
 * Needed because the posterior is incremental and therefore NOT self-
 * correcting: deleting an `AnswerKlpResult` (as a re-submit does) removes the
 * evidence but leaves its contribution baked in forever. Stepping backward is
 * not possible — the BKT update is not invertible, since `stepBkt` mixes two
 * Bayes updates and then applies a learning term, so several priors map to the
 * same posterior. The only correct response to a deletion is a replay of what
 * remains.
 *
 * Three details are load-bearing:
 * - `quizAnswer: { userId }` scopes the replay to ONE learner. `AnswerKlpResult`
 *   has no `userId` of its own and a `CardKlp` is shared by everyone studying
 *   the set, so an unscoped read would rebuild this user's posterior out of
 *   strangers' answers.
 * - `orderBy` pins replay order. Rows written by one `createMany` share a
 *   transaction timestamp, so ties are the norm, not the exception — and
 *   `traceKlp`'s sort is stable, which means tied rows replay in arrival order.
 *   Without an ORDER BY that order is whatever Postgres returns, and `stepBkt`
 *   is not commutative, so the same evidence could yield different numbers on
 *   different reads.
 * - The delete branch. A KLP whose every row was just cascaded away has no
 *   evidence left; leaving the old row behind would claim knowledge from
 *   observations that no longer exist, and keep it above `MIN_OBSERVATIONS`.
 */
export async function rebuildKlpStates(
  tx: KlpRebuildTx,
  userId: string,
  klpIds: string[],
): Promise<void> {
  if (klpIds.length === 0) return

  const rows = await tx.answerKlpResult.findMany({
    where: { klpId: { in: klpIds }, quizAnswer: { userId } },
    select: { klpId: true, status: true, mode: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const rebuilt = new Map(
    rebuildStatesFromResults(userId, rows).map((s) => [s.klpId, s]),
  )

  for (const klpId of klpIds) {
    const s = rebuilt.get(klpId)
    if (!s) {
      await tx.klpState.deleteMany({ where: { userId, klpId } })
      continue
    }
    const data = {
      pKnown: s.pKnown,
      observations: s.observations,
      lastObservedAt: s.lastObservedAt,
    }
    await tx.klpState.upsert({
      where: { userId_klpId: { userId, klpId } },
      create: { userId, klpId, ...data },
      update: data,
    })
  }
}
