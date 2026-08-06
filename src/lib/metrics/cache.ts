import { stepBkt, traceKlp, BKT_PRIOR, type KlpObservation } from '@/lib/metrics/bkt'

/** The pure shape of a KlpState row. No Prisma types here. */
export interface KlpStateRow {
  userId: string
  klpId: string
  pKnown: number
  observations: number
  lastObservedAt: Date
}

/**
 * Step the stored posterior forward by one observation.
 *
 * This is why the cache never needs invalidating: BKT's posterior after N
 * observations is a function of the posterior after N-1 and the new one, so a
 * new answer is a single row update rather than a replay.
 */
export function applyObservation(state: KlpStateRow, obs: KlpObservation): KlpStateRow {
  return {
    ...state,
    pKnown: stepBkt(state.pKnown, obs),
    observations: state.observations + 1,
    lastObservedAt:
      obs.createdAt > state.lastObservedAt ? obs.createdAt : state.lastObservedAt,
  }
}

/**
 * Full replay from scratch. Needed only when the inputs themselves change —
 * a Spec 3B band edit, or a resubmit-cascade re-analysis — never on a new
 * answer.
 */
export function rebuildState(
  userId: string,
  klpId: string,
  observations: KlpObservation[],
): KlpStateRow {
  const traced = traceKlp(observations)
  const latest = observations.reduce<Date | null>(
    (acc, o) => (acc === null || o.createdAt > acc ? o.createdAt : acc),
    null,
  )

  return {
    userId,
    klpId,
    pKnown: observations.length === 0 ? BKT_PRIOR : traced.pKnown,
    observations: traced.observations,
    lastObservedAt: latest ?? new Date(0),
  }
}
