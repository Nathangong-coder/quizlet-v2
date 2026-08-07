import { describe, it, expect } from 'vitest'
import { persistKlpStates, type KlpObservationWrite } from '@/lib/metrics/state-writer'
import { rebuildStatesFromResults, type KlpStateRow } from '@/lib/metrics/cache'
import { BKT_PRIOR } from '@/lib/metrics/bkt'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const at = (mins: number): Date => new Date(NOW.getTime() + mins * 60_000)

const res = (o: Partial<KlpObservationWrite> = {}): KlpObservationWrite => ({
  klpId: 'klp1',
  status: 'passed',
  mode: 'quiz-mc',
  ...o,
})

/** Stands in for the transaction client the action binds its closures to. */
function fakeStore() {
  const rows = new Map<string, KlpStateRow>()
  const saves: KlpStateRow[] = []
  return {
    rows,
    saves,
    load: async (klpId: string) => rows.get(klpId) ?? null,
    save: async (state: KlpStateRow) => {
      saves.push({ ...state })
      rows.set(state.klpId, state)
    },
  }
}

describe('persistKlpStates', () => {
  it('writes a state for every KLP the answer observed', async () => {
    // The bug: nothing in production wrote KlpState at all, so `knowledge` was
    // permanently `{}` — every topic's knowledge null, and every `too_terse`
    // booked as a knowledge gap.
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1',
      results: [res({ klpId: 'k1' }), res({ klpId: 'k2', status: 'failed' })],
      observedAt: NOW,
      load: store.load,
      save: store.save,
    })

    expect([...store.rows.keys()].sort()).toEqual(['k1', 'k2'])
    expect(store.rows.get('k1')!.observations).toBe(1)
    expect(store.rows.get('k1')!.userId).toBe('u1')
    expect(store.rows.get('k1')!.pKnown).not.toBe(BKT_PRIOR)
  })

  it('writes nothing when the answer attributed nothing', async () => {
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1', results: [], observedAt: NOW, load: store.load, save: store.save,
    })
    expect(store.saves).toHaveLength(0)
  })

  it('accumulates across answers instead of overwriting', async () => {
    const store = fakeStore()
    for (const n of [0, 1, 2]) {
      await persistKlpStates({
        userId: 'u1', results: [res()], observedAt: at(n), load: store.load, save: store.save,
      })
    }
    expect(store.rows.get('klp1')!.observations).toBe(3)
    expect(store.rows.get('klp1')!.lastObservedAt.getTime()).toBe(at(2).getTime())
  })

  it('composes two results naming the same KLP in one answer', async () => {
    // Sequential, not concurrent: a parallel read-then-write would have both
    // observations read the same pre-state and one would be lost.
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1',
      results: [res(), res()],
      observedAt: NOW,
      load: store.load,
      save: store.save,
    })
    expect(store.rows.get('klp1')!.observations).toBe(2)
  })

  it('converges with the backfill replay over the same evidence', async () => {
    const results = [
      res({ status: 'failed', mode: 'quiz-sa' }),
      res({ status: 'passed', mode: 'quiz-mc' }),
      res({ status: 'partial', mode: 'quiz-tf' }),
    ]
    const store = fakeStore()
    for (const [i, r] of results.entries()) {
      await persistKlpStates({
        userId: 'u1', results: [r], observedAt: at(i), load: store.load, save: store.save,
      })
    }

    const [rebuilt] = rebuildStatesFromResults(
      'u1',
      results.map((r, i) => ({ ...r, createdAt: at(i) })),
    )
    expect(store.rows.get('klp1')!.pKnown).toBeCloseTo(rebuilt.pKnown, 10)
    expect(store.rows.get('klp1')!.observations).toBe(rebuilt.observations)
  })

  it('stamps the answer clock, not wall time, so a replay reproduces it', async () => {
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1', results: [res()], observedAt: at(99), load: store.load, save: store.save,
    })
    expect(store.rows.get('klp1')!.lastObservedAt.getTime()).toBe(at(99).getTime())
  })
})
