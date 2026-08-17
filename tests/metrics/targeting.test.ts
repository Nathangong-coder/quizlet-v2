import { describe, it, expect } from 'vitest'
import { rankCandidates, toRankCandidates } from '@/lib/metrics/targeting'
import type { RankCandidate } from '@/lib/metrics/targeting'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

const NOW = new Date('2026-08-06T12:00:00.000Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)
const FLOOR = DEFAULT_THRESHOLDS.minObservations

const cand = (o: Partial<RankCandidate> & { klpId: string }): RankCandidate => ({
  topicKey: 'valuation',
  weight: 3,
  pKnown: 0.5,
  observations: 5,
  readiness: 0.5,
  dueAt: null,
  ...o,
})

const idsInOrder = (ranked: { klpId: string }[]) => ranked.map((r) => r.klpId)
const ALL_STRATEGIES = [
  'shore_up_weaknesses', 'polish_near_ready', 'follow_forgetting', 'balanced',
] as const

describe('shore_up_weaknesses', () => {
  it('puts the least-known proposition first', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'strong', pKnown: 0.9 }), cand({ klpId: 'weak', pKnown: 0.1 })],
      'shore_up_weaknesses', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('weak')
  })

  it('breaks ties toward the more central proposition', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'minor', pKnown: 0.2, weight: 1 }), cand({ klpId: 'central', pKnown: 0.2, weight: 5 })],
      'shore_up_weaknesses', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('central')
  })
})

describe('polish_near_ready', () => {
  it('puts known-but-poorly-expressed first, ahead of an unknown one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'unknown', pKnown: 0.1, readiness: 0.1 }),
        cand({ klpId: 'knows-cant-say', pKnown: 0.9, readiness: 0.1 }),
      ],
      'polish_near_ready', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('knows-cant-say')
  })

  it('ranks a known and well-expressed proposition below a known and poorly-expressed one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'done', pKnown: 0.9, readiness: 1 }),
        cand({ klpId: 'rough', pKnown: 0.9, readiness: 0.2 }),
      ],
      'polish_near_ready', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('rough')
  })

  it('treats unknown readiness as no articulation problem, not a severe one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'unmeasured', pKnown: 0.9, readiness: null }),
        cand({ klpId: 'measured-bad', pKnown: 0.9, readiness: 0.2 }),
      ],
      'polish_near_ready', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('measured-bad')
  })
})

describe('follow_forgetting', () => {
  it('puts the most overdue first', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'fresh', dueAt: daysAgo(0) }), cand({ klpId: 'stale', dueAt: daysAgo(10) })],
      'follow_forgetting', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('stale')
  })

  it('ranks a not-yet-due proposition below any overdue one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'future', dueAt: new Date(NOW.getTime() + 86_400_000) }),
        cand({ klpId: 'overdue', dueAt: daysAgo(1) }),
      ],
      'follow_forgetting', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('overdue')
  })
})

describe('the observation floor applies under every strategy', () => {
  it('ranks a sub-threshold candidate last even when its metrics look ideal', () => {
    for (const strategy of ALL_STRATEGIES) {
      const ranked = rankCandidates(
        [
          cand({ klpId: 'thin', pKnown: 0.01, observations: FLOOR - 1, weight: 5, dueAt: daysAgo(30), readiness: 0 }),
          cand({ klpId: 'measured', pKnown: 0.5, observations: FLOOR }),
        ],
        strategy, { now: NOW },
      )
      expect(idsInOrder(ranked)[1], strategy).toBe('thin')
    }
  })

  it('marks sub-threshold candidates so a caller can label them', () => {
    const [only] = rankCandidates([cand({ klpId: 'thin', observations: 1 })], 'balanced', { now: NOW })
    expect(only.sufficient).toBe(false)
  })

  it('orders the sub-threshold group by EVIDENCE, not by score', () => {
    // Below the floor, `score` is mostly a function of the BKT prior, so
    // ordering by it ranks noise. Observations are the one thing that really
    // differs, and "closest to being measurable" is the useful order.
    //
    // The fixture is built so score and observations DISAGREE: `none` has the
    // most attractive score under shore_up_weaknesses (lowest pKnown, top
    // weight) but no evidence at all, so it must still sort last.
    const ranked = rankCandidates(
      [
        cand({ klpId: 'none', observations: 0, pKnown: 0.01, weight: 5 }),
        cand({ klpId: 'two', observations: 2, pKnown: 0.9, weight: 1 }),
        cand({ klpId: 'one', observations: 1, pKnown: 0.5, weight: 3 }),
      ],
      'shore_up_weaknesses',
      { now: NOW, thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 5 } },
    )
    expect(ranked.every((c) => !c.sufficient)).toBe(true)
    expect(idsInOrder(ranked)).toEqual(['two', 'one', 'none'])
  })

  it('orders sub-threshold candidates by evidence under EVERY strategy', () => {
    for (const strategy of ALL_STRATEGIES) {
      const ranked = rankCandidates(
        [
          cand({ klpId: 'none', observations: 0, pKnown: 0.01, weight: 5, dueAt: daysAgo(30), readiness: 0 }),
          cand({ klpId: 'two', observations: 2, pKnown: 0.9, weight: 1, readiness: 1 }),
        ],
        strategy,
        { now: NOW, thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 5 } },
      )
      expect(idsInOrder(ranked), strategy).toEqual(['two', 'none'])
    }
  })

  it('falls back to score when two sub-threshold candidates have equal evidence', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'stronger', observations: 2, pKnown: 0.9, weight: 5 }),
        cand({ klpId: 'weaker', observations: 2, pKnown: 0.1, weight: 5 }),
      ],
      'shore_up_weaknesses',
      { now: NOW, thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 5 } },
    )
    expect(idsInOrder(ranked)).toEqual(['weaker', 'stronger'])
  })

  it('does NOT reorder the measured group by evidence', () => {
    // The evidence rule is scoped to the sub-threshold group. Applying it above
    // the floor would override the learner's chosen strategy with a proxy for
    // "how much have I answered this", which is not what any strategy means.
    const ranked = rankCandidates(
      [
        cand({ klpId: 'many-answers-known', observations: 50, pKnown: 0.95, weight: 5 }),
        cand({ klpId: 'few-answers-weak', observations: FLOOR, pKnown: 0.05, weight: 5 }),
      ],
      'shore_up_weaknesses',
      { now: NOW },
    )
    expect(ranked.every((c) => c.sufficient)).toBe(true)
    expect(idsInOrder(ranked)).toEqual(['few-answers-weak', 'many-answers-known'])
  })

  it('honours a LOWERED floor from the learner, promoting a candidate the default demotes', () => {
    // Spec 3B's reason for exposing the knob: at the shipped floor of 3, a
    // corpus where every KLP has been seen once ranks everything as
    // insufficient, so the order carries no information at all.
    const input = [
      cand({ klpId: 'thin-and-weak', pKnown: 0.05, observations: 1 }),
      cand({ klpId: 'measured-and-fine', pKnown: 0.9, observations: FLOOR }),
    ]
    expect(idsInOrder(rankCandidates(input, 'shore_up_weaknesses', { now: NOW }))[0])
      .toBe('measured-and-fine')
    expect(
      idsInOrder(rankCandidates(input, 'shore_up_weaknesses', {
        now: NOW, thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
      }))[0],
    ).toBe('thin-and-weak')
  })
})

describe('shared contract', () => {
  it('returns every candidate under every strategy, never dropping any', () => {
    const input = [cand({ klpId: 'a' }), cand({ klpId: 'b' }), cand({ klpId: 'c' })]
    for (const strategy of ALL_STRATEGIES) {
      expect(rankCandidates(input, strategy, { now: NOW }), strategy).toHaveLength(3)
    }
  })

  it('is a pure function — it does not reorder the caller\'s array', () => {
    // Ids are deliberately NOT in alphabetical order, and the ranked order is
    // the reverse of the input order. Both matter: with ['a','b'] as input the
    // assertion passes under an in-place ALPHABETICAL sort, which is a real
    // in-place mutation that a purity test must still catch.
    const input = [cand({ klpId: 'b', pKnown: 0.9 }), cand({ klpId: 'a', pKnown: 0.1 })]
    const ranked = rankCandidates(input, 'shore_up_weaknesses', { now: NOW })
    expect(idsInOrder(ranked)).toEqual(['a', 'b'])
    expect(idsInOrder(input)).toEqual(['b', 'a'])
  })

  it('balanced differs from at least one single-axis strategy on the same input', () => {
    const input = [
      cand({ klpId: 'x', pKnown: 0.9, readiness: 0.1, dueAt: daysAgo(20) }),
      cand({ klpId: 'y', pKnown: 0.1, readiness: 1, dueAt: null }),
    ]
    expect(idsInOrder(rankCandidates(input, 'balanced', { now: NOW })))
      .not.toEqual(idsInOrder(rankCandidates(input, 'shore_up_weaknesses', { now: NOW })))
  })
})

describe('toRankCandidates', () => {
  const base = {
    topics: [
      { key: 'valuation', klpIds: ['k1', 'k2'], readiness: 0.4 },
      { key: 'accounting', klpIds: ['k3'], readiness: null },
    ],
    klpWeights: { k1: 5, k2: 2, k3: 4 },
    knowledge: {
      k1: { pKnown: 0.8, observations: 6 },
      k2: { pKnown: 0.3, observations: 4 },
    },
    klpCardIds: { k1: 'cardA', k2: 'cardA', k3: 'cardB' },
    dueByCard: { cardA: new Date('2026-08-01T00:00:00Z') },
  }

  it('emits one candidate per KLP, carrying its topic\'s readiness', () => {
    const out = toRankCandidates(base)
    expect(out).toHaveLength(3)
    expect(out.find((c) => c.klpId === 'k1')!.readiness).toBe(0.4)
    expect(out.find((c) => c.klpId === 'k3')!.readiness).toBeNull()
  })

  it('defaults an unmeasured KLP to the prior with zero observations, not to omission', () => {
    // k3 has no knowledge entry. It must still appear — the observation floor
    // ranks it last, but dropping it would hide the KLP entirely.
    expect(toRankCandidates(base).find((c) => c.klpId === 'k3')!.observations).toBe(0)
  })

  it('resolves due date through the KLP\'s card', () => {
    const out = toRankCandidates(base)
    expect(out.find((c) => c.klpId === 'k1')!.dueAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(out.find((c) => c.klpId === 'k3')!.dueAt).toBeNull()
  })

  it('does not emit a KLP twice when two topics share it', () => {
    const out = toRankCandidates({
      ...base,
      topics: [
        { key: 'valuation', klpIds: ['k1'], readiness: 0.4 },
        { key: 'dcf', klpIds: ['k1'], readiness: 0.9 },
      ],
    })
    expect(out.filter((c) => c.klpId === 'k1')).toHaveLength(1)
  })

  it('gives a KLP with no stored weight the neutral centrality, not zero', () => {
    // Weight 0 would zero out shore_up_weaknesses' score and bury a
    // legitimately weak proposition behind every scored one.
    const out = toRankCandidates({ ...base, klpWeights: {} })
    expect(out.every((c) => c.weight === 3)).toBe(true)
  })
})
