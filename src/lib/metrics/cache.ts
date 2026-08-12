import { stepBkt, traceKlp, BKT_PRIOR, type KlpObservation } from '@/lib/metrics/bkt'
import type { KlpStatus } from '@/lib/errors/klp-credit'
import type { StudySource } from '@/lib/memory/scoring'

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
 * Full replay from scratch. Needed only when the stored EVIDENCE changes —
 * i.e. an `AnswerKlpResult` row is deleted, as a resubmit cascade does. Never
 * on a new answer, and never on a settings change.
 *
 * A Spec 3B band edit is NOT such a case, despite an earlier version of this
 * comment saying so. `stepBkt` reads `status` and `mode` only; bands feed
 * severity -> significance -> readiness and the verbosity index, all derived at
 * read time. Wiring a replay onto a band save would be expensive work that
 * changes no number here — see the corrected §3.3 of
 * `docs/superpowers/specs/2026-08-05-spec3b-tunable-scoring-and-targeting-design.md`.
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

/**
 * Create-or-step: the whole decision a writer with a possibly-absent row makes.
 *
 * Lives here rather than inline in the action so "no row yet means start from
 * the prior and apply this observation, NOT start from the prior and stop" is
 * a tested rule. Getting that wrong writes a row that looks materialized but
 * carries zero evidence — indistinguishable, at read time, from a learner who
 * has genuinely never been observed.
 */
export function nextKlpState(
  existing: KlpStateRow | null,
  userId: string,
  klpId: string,
  obs: KlpObservation,
): KlpStateRow {
  return existing === null
    ? rebuildState(userId, klpId, [obs])
    : applyObservation(existing, obs)
}

/** An `AnswerKlpResult` row, as far as BKT is concerned. */
export interface KlpResultLike {
  klpId: string
  status: string
  mode: string
  createdAt: Date
}

/**
 * Group persisted KLP results into a full replay per (user, KLP).
 *
 * The backfill's only decision, and the resubmit-cascade's: `status` and `mode`
 * are read UNMULTIPLIED (never the stored `credit` float) because BKT wants
 * them in two different positions — see `stepBkt`. Rows arrive in arbitrary
 * order; `traceKlp` sorts, so this need not.
 */
export function rebuildStatesFromResults(
  userId: string,
  results: KlpResultLike[],
): KlpStateRow[] {
  const byKlp = new Map<string, KlpObservation[]>()
  for (const r of results) {
    const obs: KlpObservation = {
      status: r.status as KlpStatus,
      mode: r.mode as StudySource,
      createdAt: r.createdAt,
    }
    const list = byKlp.get(r.klpId)
    if (list) list.push(obs)
    else byKlp.set(r.klpId, [obs])
  }

  return [...byKlp].map(([klpId, observations]) =>
    rebuildState(userId, klpId, observations),
  )
}
