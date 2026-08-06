import { describe, it, expect } from 'vitest'
import { applyObservation, rebuildState } from '@/lib/metrics/cache'
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
