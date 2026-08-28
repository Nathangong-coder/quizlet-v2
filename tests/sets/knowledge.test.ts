import { describe, it, expect } from 'vitest'
import {
  shapeTopicMastery,
  shapeConfidenceHistogram,
  shapeCategoryMastery,
  shadesByKey,
} from '@/lib/sets/knowledge'
import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'

const topic = (over: Partial<LearnerTopicProfile> = {}): LearnerTopicProfile => ({
  key: 'valuation',
  name: 'Valuation',
  color: null,
  depth: 1,
  klpCount: 8,
  knowledge: 0.4,
  verbosityIndex: 0,
  knowledgeGapTerseness: 0,
  readiness: 0.5,
  ...over,
})

describe('shapeTopicMastery', () => {
  it('carries a null knowledge through as null, never as 0', () => {
    const [row] = shapeTopicMastery([topic({ knowledge: null })])
    expect(row.knowledge).toBeNull()
    expect(row.shade).toBe('unknown')
  })

  it('sorts measured concepts weakest first', () => {
    const rows = shapeTopicMastery([
      topic({ key: 'a', name: 'A', knowledge: 0.8 }),
      topic({ key: 'b', name: 'B', knowledge: 0.2 }),
      topic({ key: 'c', name: 'C', knowledge: 0.5 }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['b', 'c', 'a'])
  })

  it('sorts UNMEASURED concepts last, not first-as-zero', () => {
    // `knowledge ?? 0` would float every untested concept to the top and bury
    // the ones the learner is actually failing — a list sorted by "what we have
    // not looked at" while claiming to be sorted by weakness.
    const rows = shapeTopicMastery([
      topic({ key: 'untested', name: 'Untested', knowledge: null }),
      topic({ key: 'failing', name: 'Failing', knowledge: 0.05 }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['failing', 'untested'])
  })

  it('orders several unmeasured concepts by name so the list is stable', () => {
    const rows = shapeTopicMastery([
      topic({ key: 'z', name: 'Zebra', knowledge: null }),
      topic({ key: 'a', name: 'Apple', knowledge: null }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['a', 'z'])
  })

  it('keeps a category depth of null rather than inventing a tree position', () => {
    expect(shapeTopicMastery([topic({ depth: null })])[0].depth).toBeNull()
  })

  it('returns an empty list for no topics', () => {
    expect(shapeTopicMastery([])).toEqual([])
  })
})

describe('shadesByKey', () => {
  it('maps every row key to its shade', () => {
    const rows = shapeTopicMastery([
      topic({ key: 'a', knowledge: 0.9 }),
      topic({ key: 'b', knowledge: null }),
    ])
    expect(shadesByKey(rows)).toEqual({ a: 'strong', b: 'unknown' })
  })
})

describe('shapeConfidenceHistogram', () => {
  const now = new Date('2026-08-28T12:00:00Z')
  const past = new Date('2026-08-01T12:00:00Z')
  const future = new Date('2026-09-30T12:00:00Z')

  it('counts a NULL dueAt as due', () => {
    // Matches getDueCards and shapeSetSummaries. Null means never scheduled,
    // which is a reason to review a card, not to hide it. Diverging here makes
    // this page report fewer due cards than Review mode actually offers.
    expect(shapeConfidenceHistogram([{ confidence: 5, dueAt: null }], now).due).toBe(1)
  })

  it('counts a card due exactly now as due', () => {
    expect(shapeConfidenceHistogram([{ confidence: 5, dueAt: now }], now).due).toBe(1)
  })

  it('does not count a card due later', () => {
    expect(shapeConfidenceHistogram([{ confidence: 5, dueAt: future }], now).due).toBe(0)
  })

  it('counts an overdue card', () => {
    expect(shapeConfidenceHistogram([{ confidence: 5, dueAt: past }], now).due).toBe(1)
  })

  it('returns a NULL average for an unstudied set, never 0', () => {
    // Zero reads as "you know none of this" on a set nobody has opened.
    const out = shapeConfidenceHistogram([], now)
    expect(out.average).toBeNull()
    expect(out.studied).toBe(0)
    expect(out.buckets).toHaveLength(10)
    expect(out.buckets.every((b) => b === 0)).toBe(true)
  })

  it('buckets confidence 1 first and 10 last', () => {
    const out = shapeConfidenceHistogram(
      [
        { confidence: 1, dueAt: future },
        { confidence: 10, dueAt: future },
      ],
      now,
    )
    expect(out.buckets[0]).toBe(1)
    expect(out.buckets[9]).toBe(1)
  })

  it('clamps an out-of-range confidence instead of losing the card', () => {
    // A value outside 1-10 would index past the array and render as a silently
    // missing bar — a card that exists but appears nowhere.
    const out = shapeConfidenceHistogram(
      [
        { confidence: 0, dueAt: future },
        { confidence: 99, dueAt: future },
      ],
      now,
    )
    expect(out.buckets[0]).toBe(1)
    expect(out.buckets[9]).toBe(1)
    expect(out.buckets.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('averages over studied cards', () => {
    const out = shapeConfidenceHistogram(
      [
        { confidence: 4, dueAt: future },
        { confidence: 6, dueAt: future },
      ],
      now,
    )
    expect(out.average).toBe(5)
  })
})

describe('shapeCategoryMastery', () => {
  const cat = (over = {}) => ({
    normalizedName: 'valuation',
    name: 'Valuation',
    color: '#123456',
    cardCount: 12,
    ...over,
  })

  it('keeps a category the profile has no evidence for', () => {
    // "You have a category with no evidence yet" is exactly what this view
    // should be able to say. Dropping it would make the category silently
    // vanish from a page whose job is to describe the set.
    const [row] = shapeCategoryMastery([cat()], [])
    expect(row.knowledge).toBeNull()
    expect(row.shade).toBe('unknown')
  })

  it('joins measured knowledge by normalizedName', () => {
    const [row] = shapeCategoryMastery([cat()], [topic({ key: 'valuation', knowledge: 0.9 })])
    expect(row.knowledge).toBe(0.9)
    expect(row.shade).toBe('strong')
  })

  it('does not join on the display name', () => {
    // Categories are keyed on normalizedName precisely so `Valuation` and
    // `valuation` cannot become two topics.
    const [row] = shapeCategoryMastery([cat()], [topic({ key: 'Valuation', knowledge: 0.9 })])
    expect(row.knowledge).toBeNull()
  })

  it('orders by card count, then name', () => {
    const rows = shapeCategoryMastery(
      [
        cat({ normalizedName: 'a', name: 'A', cardCount: 2 }),
        cat({ normalizedName: 'b', name: 'B', cardCount: 9 }),
      ],
      [],
    )
    expect(rows.map((r) => r.key)).toEqual(['b', 'a'])
  })

  it('preserves the category colour', () => {
    expect(shapeCategoryMastery([cat()], [])[0].color).toBe('#123456')
  })
})
