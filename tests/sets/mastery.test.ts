import { describe, it, expect } from 'vitest'
import { shapeMastery, summarizeMastery, groupMastery, UNCATEGORIZED_GROUP } from '@/lib/sets/mastery'

const cards = [
  { id: 'c1', term: 'DTL', definition: 'd1', position: 0, categoryIds: ['acct'], confidence: 7 },
  { id: 'c2', term: 'WACC', definition: 'd2', position: 1, categoryIds: ['val', 'acct'], confidence: null },
  { id: 'c3', term: 'Loose', definition: 'd3', position: 2, categoryIds: [], confidence: null },
]
const klps = [
  { id: 'k1', cardId: 'c1', text: 'arises when book tax < cash tax', label: null, weight: 5, kind: 'mechanism', role: 'substance' },
  { id: 'k2', cardId: 'c1', text: 'reverses as timing differences unwind', label: 'Reverses on unwind', weight: 3, kind: 'causal', role: null },
  { id: 'k3', cardId: 'c2', text: 'weighted by capital structure', label: null, weight: 4, kind: 'definition', role: 'framing' },
]

describe('mastery shaping', () => {
  it('shades a point by measured knowledge and reads below-floor evidence as NOT measured', () => {
    const shaped = shapeMastery({
      cards,
      klps,
      states: [
        { klpId: 'k1', pKnown: 0.9, observations: 4 },
        { klpId: 'k2', pKnown: 0.1, observations: 1 }, // under the floor of 2
      ],
      floor: 2,
    })
    const c1 = shaped[0]
    expect(c1.points.map((p) => [p.id, p.shade, p.knowledge])).toEqual([
      ['k1', 'strong', 0.9],
      ['k2', 'unknown', null],
    ])
    // The card's knowledge is the weight-mean over MEASURED points only.
    expect(c1.knowledge).toBe(0.9)
    expect(c1.shade).toBe('strong')
    expect(c1.confidence).toBe(7)
    // No evidence at all: unknown, never weak.
    expect(shaped[1].points[0].shade).toBe('unknown')
    expect(shaped[1].knowledge).toBeNull()
    expect(shaped[1].shade).toBe('unknown')
    // A card with no points is still a card.
    expect(shaped[2].points).toEqual([])
  })

  it('weights a card’s knowledge by point weight', () => {
    const shaped = shapeMastery({
      cards: cards.slice(0, 1),
      klps: klps.slice(0, 2),
      states: [
        { klpId: 'k1', pKnown: 1, observations: 5 }, // weight 5
        { klpId: 'k2', pKnown: 0, observations: 5 }, // weight 3
      ],
      floor: 1,
    })
    expect(shaped[0].knowledge).toBeCloseTo(5 / 8)
    expect(shaped[0].shade).toBe('solid')
  })

  it('summarizes counts and shades', () => {
    const shaped = shapeMastery({ cards, klps, states: [{ klpId: 'k1', pKnown: 0.2, observations: 3 }], floor: 1 })
    const s = summarizeMastery(shaped)
    expect(s).toMatchObject({ cards: 3, cardsWithPoints: 2, measuredCards: 1, points: 3, measuredPoints: 1 })
    expect(s.byShade).toEqual({ unknown: 2, weak: 1, developing: 0, solid: 0, strong: 0 })
  })

  it('groups by category, a card under every category it carries, the loose ones last', () => {
    const shaped = shapeMastery({ cards, klps, states: [], floor: 1 })
    const groups = groupMastery(shaped, [
      { id: 'acct', name: 'Accounting', color: '#abc' },
      { id: 'val', name: 'Valuation', color: null },
      { id: 'empty', name: 'Nothing here', color: null },
    ])
    expect(groups.map((g) => [g.key, g.cards.map((c) => c.id)])).toEqual([
      ['acct', ['c1', 'c2']],
      ['val', ['c2']],
      [UNCATEGORIZED_GROUP, ['c3']],
    ])
    expect(groups[2].name).toBe('Everything else')
    // No categories at all: one group, named for what it is.
    const one = groupMastery(shaped, [])
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe('All cards')
    expect(one[0].cards).toHaveLength(3)
  })
})
