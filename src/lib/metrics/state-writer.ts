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
 * SEQUENTIAL, deliberately: each step reads the state the previous one wrote.
 * Callers pass closures bound to their transaction, so the states and the
 * `AnswerKlpResult` rows behind them commit together.
 *
 * The results within ONE answer are distinct by KLP — `buildAnalysisWrites`
 * dedupes them, as it must, since `AnswerKlpResult` is unique on
 * `(quizAnswerId, klpId)`. (An earlier version of this comment claimed two
 * results naming the same KLP compose into two observations; the constraint
 * makes that unreachable.) The real lost-update risk is ACROSS answers, and it
 * is handled by the caller's row lock — see `lockKlpStates`.
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
 * Serialize every writer touching these (user, KLP) posteriors, for the rest
 * of the calling transaction.
 *
 * The posterior write is read-modify-write — `findUnique`, step, `upsert` with
 * an ABSOLUTE value — under Postgres's default READ COMMITTED. Two answers
 * touching one KLP in flight (a quiz fans one generation out per card, and a
 * fast learner submits the next card while the previous grading is still
 * committing) both read the same pre-state, and the second write silently
 * discards the first's observation. Because the posterior is incremental and
 * not self-correcting, that loss is permanent until a backfill replays it.
 *
 * An ADVISORY lock rather than `SELECT ... FOR UPDATE`: the row usually does
 * not exist yet on the write that matters most — the first observation of a
 * KLP — and `FOR UPDATE` locks nothing when it matches nothing, so two
 * concurrent first-writes would both proceed from a null pre-state. An
 * `xact` advisory lock is keyed on a value, not a row, so it works
 * identically whether or not the row exists, and Postgres releases it at
 * commit or rollback with no cleanup path to get wrong.
 *
 * Ids are SORTED before locking. Two transactions taking the same locks in
 * opposite orders deadlock; a total order over the keys removes that by
 * construction.
 *
 * `$executeRaw`, NOT `$queryRaw` — this is not a style choice and must not be
 * "tidied" back. `pg_advisory_xact_lock` returns `void`, and `$queryRaw` tries
 * to deserialize the result column: under the Neon driver adapter that throws
 * `P2010 / UnsupportedNativeDataType — Failed to deserialize column of type
 * 'void'`, aborting the whole transaction. `$executeRaw` runs the statement
 * and returns a row count without touching columns. Verified against a live
 * database that the lock still genuinely excludes a second transaction; the
 * fix does not quietly turn the lock into a no-op, which would reintroduce
 * exactly the lost-update defect this function exists to prevent.
 */
export async function lockKlpStates(
  tx: KlpRebuildTx,
  userId: string,
  klpIds: string[],
): Promise<void> {
  const keys = [...new Set(klpIds)].sort()
  for (const klpId of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`klpstate:${userId}:${klpId}`}, 0))`
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
