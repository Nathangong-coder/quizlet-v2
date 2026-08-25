import { describe, it, expect } from 'vitest'
import { shapeMissedWork, UNTOPICED_KEY, type ShapeMissedWorkInput } from '@/lib/metrics/missed'

const base: ShapeMissedWorkInput = {
  klps: [
    {
      klpId: 'k1',
      label: 'Debt impact on WACC',
      text: 'Long proposition one.',
      term: 'WACC',
      topicKeys: ['wacc'],
    },
    { klpId: 'k2', label: null, text: 'Long proposition two.', term: 'Leases', topicKeys: [] },
  ],
  topicNames: { wacc: 'WACC' },
  knowledge: {
    k1: { pKnown: 0.2, observations: 5 },
    k2: { pKnown: 0.4, observations: 1 },
  },
  results: [
    {
      klpId: 'k1',
      status: 'failed',
      mode: 'quiz-sa',
      createdAt: new Date('2026-08-20'),
      errorTypes: ['negated'],
    },
    {
      klpId: 'k1',
      status: 'partial',
      mode: 'quiz-mc',
      createdAt: new Date('2026-08-22'),
      errorTypes: [],
    },
    {
      klpId: 'k2',
      status: 'failed',
      mode: 'quiz-tf',
      createdAt: new Date('2026-08-21'),
      errorTypes: [],
    },
  ],
  floor: 3,
}

describe('shapeMissedWork', () => {
  it('groups missed KLPs under their topic', () => {
    const wacc = shapeMissedWork(base).find((t) => t.key === 'wacc')
    expect(wacc?.name).toBe('WACC')
    expect(wacc?.klps.map((k) => k.klpId)).toEqual(['k1'])
  })

  it('puts a KLP with no topic under Uncategorized rather than dropping it', () => {
    const none = shapeMissedWork(base).find((t) => t.key === UNTOPICED_KEY)
    expect(none?.klps.map((k) => k.klpId)).toEqual(['k2'])
    expect(none?.name).toBe('Uncategorized')
  })

  it('counts partial as a miss — half-right is still not right', () => {
    expect(shapeMissedWork(base).find((t) => t.key === 'wacc')?.klps[0].misses).toHaveLength(2)
  })

  it('ignores passed results entirely', () => {
    expect(
      shapeMissedWork({
        ...base,
        results: [
          {
            klpId: 'k1',
            status: 'passed',
            mode: 'quiz-sa',
            createdAt: new Date(),
            errorTypes: [],
          },
        ],
      }),
    ).toEqual([])
  })

  it('orders misses newest first', () => {
    const misses = shapeMissedWork(base).find((t) => t.key === 'wacc')!.klps[0].misses
    expect(misses[0].createdAt.getTime()).toBeGreaterThan(misses[1].createdAt.getTime())
  })

  it('reports knowledge as null below the floor — never as a zero', () => {
    // k2 has 1 observation against a floor of 3, so its pKnown is mostly the
    // BKT prior and stating it would claim confidence the evidence lacks.
    const out = shapeMissedWork(base)
    expect(out.find((t) => t.key === UNTOPICED_KEY)?.knowledge).toBeNull()
    expect(out.find((t) => t.key === 'wacc')?.knowledge).toBeCloseTo(0.2)
  })

  it('keeps the observation count even when pKnown is withheld', () => {
    const k2 = shapeMissedWork(base).find((t) => t.key === UNTOPICED_KEY)!.klps[0]
    expect(k2.pKnown).toBeNull()
    expect(k2.observations).toBe(1)
  })

  it('orders topics by miss count, most missed first', () => {
    const out = shapeMissedWork({
      ...base,
      results: [
        ...base.results,
        {
          klpId: 'k2',
          status: 'failed',
          mode: 'quiz-tf',
          createdAt: new Date('2026-08-23'),
          errorTypes: [],
        },
        {
          klpId: 'k2',
          status: 'failed',
          mode: 'quiz-tf',
          createdAt: new Date('2026-08-24'),
          errorTypes: [],
        },
      ],
    })
    expect(out[0].key).toBe(UNTOPICED_KEY)
  })

  it('lets one KLP appear under every topic it carries', () => {
    const out = shapeMissedWork({
      ...base,
      klps: [{ ...base.klps[0], topicKeys: ['wacc', 'bankruptcy'] }],
      topicNames: { wacc: 'WACC', bankruptcy: 'Bankruptcy' },
      results: base.results.filter((r) => r.klpId === 'k1'),
    })
    expect(out.map((t) => t.key).sort()).toEqual(['bankruptcy', 'wacc'])
  })

  it('falls back to the topic key when no display name is known', () => {
    const out = shapeMissedWork({ ...base, topicNames: {} })
    expect(out.find((t) => t.key === 'wacc')?.name).toBe('wacc')
  })

  it('returns nothing when there are no results at all', () => {
    expect(shapeMissedWork({ ...base, results: [] })).toEqual([])
  })

  it('carries error types through for the drill-down', () => {
    const misses = shapeMissedWork(base).find((t) => t.key === 'wacc')!.klps[0].misses
    expect(misses.some((m) => m.errorTypes.includes('negated'))).toBe(true)
  })
})
