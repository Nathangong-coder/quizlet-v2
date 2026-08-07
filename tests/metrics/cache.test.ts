import { describe, it, expect } from 'vitest'
import {
  applyObservation, rebuildState, nextKlpState, rebuildStatesFromResults,
} from '@/lib/metrics/cache'
import { traceKlp, BKT_PRIOR } from '@/lib/metrics/bkt'
import type { KlpObservation } from '@/lib/metrics/bkt'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const at = (mins: number): Date => new Date(NOW.getTime() + mins * 60_000)
const obs = (o: Partial<KlpObservation> = {}): KlpObservation => ({
  status: 'passed',
  mode: 'quiz-mc',
  createdAt: NOW,
  ...o,
})

describe('incremental stepping matches a full replay', () => {
  it('produces the same posterior stepping forward as tracing from scratch', () => {
    const observations = [
      obs({ status: 'failed', createdAt: at(0) }),
      obs({ status: 'passed', createdAt: at(1) }),
      obs({ status: 'partial', mode: 'quiz-sa', createdAt: at(2) }),
      obs({ status: 'passed', mode: 'quiz-sa', createdAt: at(3) }),
    ]

    let state = rebuildState('u1', 'klp1', [])
    for (const o of observations) state = applyObservation(state, o)

    const replayed = traceKlp(observations)
    expect(state.pKnown).toBeCloseTo(replayed.pKnown, 10)
    expect(state.observations).toBe(replayed.observations)
  })
})

describe('rebuildState', () => {
  it('returns the prior with no observations', () => {
    const state = rebuildState('u1', 'klp1', [])
    expect(state.pKnown).toBe(BKT_PRIOR)
    expect(state.observations).toBe(0)
  })

  it('reflects the supplied observations rather than the bare prior', () => {
    const observations = [
      obs({ status: 'passed', createdAt: at(0) }),
      obs({ status: 'passed', createdAt: at(1) }),
    ]
    const state = rebuildState('u1', 'klp1', observations)
    const replayed = traceKlp(observations)
    expect(state.pKnown).toBeCloseTo(replayed.pKnown, 10)
    expect(state.pKnown).not.toBe(BKT_PRIOR)
  })

  it('is order-independent, so a replay cannot depend on row order', () => {
    const a = obs({ status: 'failed', createdAt: at(0) })
    const b = obs({ status: 'passed', createdAt: at(5) })
    expect(rebuildState('u1', 'k', [b, a]).pKnown).toBeCloseTo(
      rebuildState('u1', 'k', [a, b]).pKnown, 10,
    )
  })
})

describe('nextKlpState (the writer\'s create-or-step decision)', () => {
  it('counts the observation when no row exists yet', () => {
    // The bug this guards: writing the bare prior on first sight would leave a
    // row that looks materialized but carries zero evidence — at read time
    // indistinguishable from a learner never observed on this KLP.
    const state = nextKlpState(null, 'u1', 'klp1', obs({ status: 'passed' }))
    expect(state.observations).toBe(1)
    expect(state.pKnown).not.toBe(BKT_PRIOR)
    expect(state.userId).toBe('u1')
    expect(state.klpId).toBe('klp1')
  })

  it('steps an existing row forward rather than restarting from the prior', () => {
    const first = nextKlpState(null, 'u1', 'klp1', obs({ status: 'passed', createdAt: at(0) }))
    const second = nextKlpState(first, 'u1', 'klp1', obs({ status: 'passed', createdAt: at(1) }))
    expect(second.observations).toBe(2)
    expect(second.pKnown).toBeGreaterThan(first.pKnown)
  })

  it('matches a full replay over the same observations', () => {
    const observations = [
      obs({ status: 'failed', createdAt: at(0) }),
      obs({ status: 'partial', mode: 'quiz-sa', createdAt: at(1) }),
      obs({ status: 'passed', mode: 'quiz-tf', createdAt: at(2) }),
    ]
    let state = null as ReturnType<typeof nextKlpState> | null
    for (const o of observations) state = nextKlpState(state, 'u1', 'klp1', o)

    const replayed = traceKlp(observations)
    expect(state!.pKnown).toBeCloseTo(replayed.pKnown, 10)
    expect(state!.observations).toBe(replayed.observations)
  })

  it('lets a failure drive the posterior below the prior', () => {
    // Knowledge must be able to move DOWN, or the signed verbosity index that
    // reads it can never book terseness as an expression gap.
    const state = nextKlpState(null, 'u1', 'klp1', obs({ status: 'failed', mode: 'quiz-sa' }))
    expect(state.pKnown).toBeLessThan(BKT_PRIOR)
  })
})

describe('rebuildStatesFromResults (backfill)', () => {
  const result = (o: Partial<{ klpId: string; status: string; mode: string; createdAt: Date }> = {}) => ({
    klpId: 'klp1', status: 'passed', mode: 'quiz-mc', createdAt: NOW, ...o,
  })

  it('produces one state per KLP, not one per row', () => {
    const states = rebuildStatesFromResults('u1', [
      result({ klpId: 'k1', createdAt: at(0) }),
      result({ klpId: 'k1', createdAt: at(1) }),
      result({ klpId: 'k2', createdAt: at(2) }),
    ])
    expect(states).toHaveLength(2)
    expect(states.find((s) => s.klpId === 'k1')!.observations).toBe(2)
    expect(states.find((s) => s.klpId === 'k2')!.observations).toBe(1)
  })

  it('agrees with stepping the same evidence forward one answer at a time', () => {
    // The backfill and the live writer must converge, or a backfilled learner
    // and a live one with identical history read differently.
    const results = [
      result({ status: 'failed', mode: 'quiz-sa', createdAt: at(0) }),
      result({ status: 'passed', mode: 'quiz-mc', createdAt: at(1) }),
      result({ status: 'partial', mode: 'quiz-tf', createdAt: at(2) }),
    ]
    let stepped = null as ReturnType<typeof nextKlpState> | null
    for (const r of results) {
      stepped = nextKlpState(stepped, 'u1', 'klp1', {
        status: r.status as 'passed', mode: r.mode as 'quiz-mc', createdAt: r.createdAt,
      })
    }
    const [rebuilt] = rebuildStatesFromResults('u1', results)
    expect(rebuilt.pKnown).toBeCloseTo(stepped!.pKnown, 10)
    expect(rebuilt.observations).toBe(stepped!.observations)
  })

  it('is order-independent, so a database row order cannot change knowledge', () => {
    const results = [
      result({ status: 'failed', createdAt: at(0) }),
      result({ status: 'passed', createdAt: at(5) }),
    ]
    const [forward] = rebuildStatesFromResults('u1', results)
    const [reversed] = rebuildStatesFromResults('u1', [...results].reverse())
    expect(reversed.pKnown).toBeCloseTo(forward.pKnown, 10)
    expect(reversed.lastObservedAt.getTime()).toBe(forward.lastObservedAt.getTime())
  })

  it('returns nothing for a user with no results rather than a prior-valued row', () => {
    expect(rebuildStatesFromResults('u1', [])).toEqual([])
  })
})

describe('lastObservedAt', () => {
  it('advances to the newest observation applied', () => {
    let state = rebuildState('u1', 'klp1', [])
    state = applyObservation(state, obs({ createdAt: at(10) }))
    expect(state.lastObservedAt.getTime()).toBe(at(10).getTime())
  })

  it('does not move backward when a later-applied observation is chronologically older', () => {
    let state = rebuildState('u1', 'klp1', [])
    state = applyObservation(state, obs({ createdAt: at(10) }))
    state = applyObservation(state, obs({ createdAt: at(2) }))
    expect(state.lastObservedAt.getTime()).toBe(at(10).getTime())
  })
})
