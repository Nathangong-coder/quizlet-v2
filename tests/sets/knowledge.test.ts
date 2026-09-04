import { describe, it, expect } from 'vitest'
import {
  shapeTopicMastery,
  shapeConfidenceHistogram,
  shapeCategoryMastery,
  shadesByKey,
  shadeForCoverage,
  selectConceptRows,
  UNCATEGORIZED_KEY,
} from '@/lib/sets/knowledge'
import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'

const topic = (over: Partial<LearnerTopicProfile> = {}): LearnerTopicProfile => ({
  key: 'valuation',
  name: 'Valuation',
  color: null,
  depth: 1,
  parentKey: null,
  klpCount: 8,
  // FULLY MEASURED by default. `shapeTopicMastery` now withholds a shade when
  // too few of a concept's key points cleared the observation floor, so a
  // fixture that left this at 0 would make every pre-existing shade assertion
  // in this file pass for the new reason instead of the one it was written
  // for. Coverage gets its own block below, with explicit counts.
  measuredKlpCount: 8,
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

  describe('the Uncategorized bucket', () => {
    it('appears when cards are in no category', () => {
      // The only thing on the page that can say "a third of this set is in no
      // topic". Silence there is indistinguishable from full coverage, and a
      // learner reading category mastery would believe the whole set had been
      // measured.
      const rows = shapeCategoryMastery([cat()], [], 7)
      const bucket = rows.find((r) => r.key === UNCATEGORIZED_KEY)
      expect(bucket).toBeDefined()
      expect(bucket?.cardCount).toBe(7)
    })

    it('is absent when every card has a category', () => {
      expect(shapeCategoryMastery([cat()], [], 0).map((r) => r.key)).toEqual(['valuation'])
    })

    it('carries null knowledge, never a measured value', () => {
      // These cards have no concept to roll up to, so nothing has measured them
      // AS a group. Spec 3C's ruling stands: uncategorized KLPs participate in
      // targeting but not in topic mastery.
      const bucket = shapeCategoryMastery([], [], 3)[0]
      expect(bucket.knowledge).toBeNull()
      expect(bucket.shade).toBe('unknown')
    })

    it('is ALWAYS LAST, even when it is the biggest bucket', () => {
      // Sorted among the real categories it would head the list on most sets,
      // presenting "no topic" as the set's main topic. It is not a category the
      // learner made; it is the absence of one.
      const rows = shapeCategoryMastery(
        [cat({ normalizedName: 'a', name: 'A', cardCount: 2 })],
        [],
        999,
      )
      expect(rows[rows.length - 1].key).toBe(UNCATEGORIZED_KEY)
    })

    it('does not collide with a real category literally named "Uncategorized"', () => {
      const rows = shapeCategoryMastery(
        [cat({ normalizedName: 'uncategorized', name: 'Uncategorized', cardCount: 4 })],
        [],
        2,
      )
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((r) => r.key)).size).toBe(2)
    })
  })
})

describe('shadeForCoverage', () => {
  it('withholds a shade when too few key points were measured', () => {
    // The reported bug in one line: a concept rolled up from 40 key points,
    // three of them answered well, painted `strong` on the map. 3/40 is far
    // under the floor, so the honest answer is "not measured yet".
    expect(shadeForCoverage(0.95, 3, 40)).toBe('unknown')
  })

  it('shades normally once coverage clears the floor', () => {
    expect(shadeForCoverage(0.95, 20, 40)).toBe('strong')
  })

  it('treats exactly the floor as sufficient, not insufficient', () => {
    // A boundary that excludes its own threshold makes two concepts with
    // identical coverage render differently depending on rounding.
    expect(shadeForCoverage(0.95, 1, 3)).toBe('strong')
  })

  it('is unknown for a null knowledge however good the coverage', () => {
    expect(shadeForCoverage(null, 10, 10)).toBe('unknown')
  })

  it('is unknown for a concept with no key points, without dividing by zero', () => {
    expect(shadeForCoverage(0.9, 0, 0)).toBe('unknown')
  })

  it('still reports a MEASURED zero as weak, never as unmeasured', () => {
    // Being measured at zero is real information; only the ABSENCE of
    // measurement is `unknown`. This is the half of `shadeForKnowledge`'s rule
    // the coverage floor must not swallow.
    expect(shadeForCoverage(0, 10, 10)).toBe('weak')
  })
})

function topicForest(key: string, parentKey: string | null, depth: number | null): LearnerTopicProfile {
  return {
    key,
    name: key,
    color: null,
    depth,
    parentKey,
    klpCount: 2,
    measuredKlpCount: 2,
    knowledge: 0.5,
    verbosityIndex: null as unknown as number,
    knowledgeGapTerseness: null as unknown as number,
    readiness: null,
  }
}

describe('selectConceptRows', () => {
  /**
   * THE REPORTED BUG. Both the depth-1 and depth-2 rungs exceeded the old
   * MAX_CONCEPTS_LISTED of 5, so selectConceptListDepth fell back to the
   * shallowest rung and the list showed exactly two roots. Every node must now
   * be present.
   */
  it('returns every concept at every depth, not one rung', () => {
    const topics = [
      topicForest('dcf', null, 0),
      topicForest('accounting', null, 0),
      ...Array.from({ length: 6 }, (_, i) => topicForest(`mid${i}`, 'dcf', 1)),
      ...Array.from({ length: 9 }, (_, i) => topicForest(`leaf${i}`, 'mid0', 2)),
    ]
    const rows = selectConceptRows(topics)
    expect(rows).toHaveLength(17)
    expect(rows.map((r) => r.key)).toContain('leaf8')
  })

  it('marks interior nodes as having children and leaves as not', () => {
    const rows = selectConceptRows([topicForest('a', null, 0), topicForest('b', 'a', 1)])
    expect(rows.find((r) => r.key === 'a')!.hasChildren).toBe(true)
    expect(rows.find((r) => r.key === 'b')!.hasChildren).toBe(false)
  })

  /**
   * kltRowsToTopicRows DROPS a topic whose links are all superseded, so a
   * parent genuinely can be absent. An orphan must render as a root — never
   * vanish, which is the bug this whole task exists to fix, recreated one level
   * down.
   */
  it('reparents an orphan to the root instead of dropping it', () => {
    const rows = selectConceptRows([topicForest('child', 'gone', 2)])
    expect(rows).toHaveLength(1)
    expect(rows[0].parentKey).toBeNull()
  })

  /**
   * Two sets may file the same concept under different parents, and
   * shapeTopicProfile merges them by name — so a cycle is reachable. A cycle
   * would hang the renderer.
   */
  it('breaks a parent cycle by rooting the offending node', () => {
    const rows = selectConceptRows([topicForest('a', 'b', 1), topicForest('b', 'a', 1)])
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.parentKey === null).length).toBeGreaterThanOrEqual(1)
  })

  it('treats a category (null depth, null parent) as a root', () => {
    const rows = selectConceptRows([topicForest('vocab', null, null)])
    expect(rows[0].parentKey).toBeNull()
  })

  it('returns an empty list for no topics', () => {
    expect(selectConceptRows([])).toEqual([])
  })
})
