import { nextKlpState, type KlpStateRow } from '@/lib/metrics/cache'
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
