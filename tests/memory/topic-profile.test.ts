import { describe, it, expect } from 'vitest'
import { shapeTopicProfile, composeLearnerProfile, toTopicRows } from '@/lib/memory/topic-profile'
import type { TopicRow } from '@/lib/memory/topic-profile'
import type { LearnerCardProfile } from '@/lib/memory/profile'
import type { DerivedTag } from '@/lib/errors/derive'

const NOW = new Date('2026-08-05T12:00:00.000Z')

const row = (o: Partial<TopicRow> & { normalizedName: string }): TopicRow => ({
  displayName: 'Valuation',
  color: '#3b82f6',
  klpIds: ['klp1'],
  cardIds: ['card1'],
  ...o,
})

const tag = (o: Partial<DerivedTag> = {}): DerivedTag => ({
  attemptId: 'a1',
  cardId: 'card1',
  dimension: 'conciseness',
  type: 'rambling',
  klpId: 'klp1',
  relevance: 3,
  starred: false,
  magnitude: 8,
  storedSeverity: 3,
  storedSignificance: 6,
  mode: 'quiz-sa',
  createdAt: NOW,
  severity: 3,
  repeatBonus: 0,
  significance: 6,
  isLegacy: false,
  ...o,
})

describe('topic keying', () => {
  it('groups per-set category rows sharing a normalizedName into one topic', () => {
    const result = shapeTopicProfile({
      topics: [
        row({ normalizedName: 'valuation', displayName: 'Valuation', klpIds: ['k1'] }),
        row({ normalizedName: 'valuation', displayName: 'valuation', klpIds: ['k2'] }),
      ],
      knowledge: {
        k1: { pKnown: 0.8, observations: 5 },
        k2: { pKnown: 0.4, observations: 5 },
      },
      tags: [],
      // This test asserts grouping, not readiness — an empty map is fine and
      // honest here; it must still be written out, not defaulted in.
      analyzedAnswersByTopic: {},
    })

    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('valuation')
    expect(result[0].klpCount).toBe(2)
  })

  it('averages pKnown across the topic KLPs that clear the observation floor', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k1', 'k2'] })],
      knowledge: {
        k1: { pKnown: 0.9, observations: 5 },
        k2: { pKnown: 0.5, observations: 5 },
      },
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(result[0].knowledge).toBeCloseTo(0.7, 5)
  })

  it('reports null knowledge when no KLP clears the observation floor', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k1'] })],
      knowledge: { k1: { pKnown: 0.9, observations: 1 } },
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(result[0].knowledge).toBeNull()
  })

  it('yields readiness: null for a topic present in topics but absent from analyzedAnswersByTopic', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k1'] })],
      knowledge: { k1: { pKnown: 0.9, observations: 5 } },
      tags: [],
      // 'dcf' has propositions but no analyzed answers yet — the real-world
      // case the per-topic lookup exists to handle. Must not crash and must
      // not silently read as 0 (fully unready); it must be null (unknown).
      analyzedAnswersByTopic: {},
    })
    expect(result[0].readiness).toBeNull()
  })
})

describe('articulation scoping per topic', () => {
  it('scopes tags to only the KLPs belonging to each topic', () => {
    const result = shapeTopicProfile({
      topics: [
        row({ normalizedName: 'a', klpIds: ['ka'] }),
        row({ normalizedName: 'b', klpIds: ['kb'] }),
      ],
      knowledge: {
        ka: { pKnown: 0.9, observations: 5 },
        kb: { pKnown: 0.9, observations: 5 },
      },
      tags: [tag({ klpId: 'ka', dimension: 'conciseness', type: 'rambling', significance: 6 })],
      analyzedAnswersByTopic: { a: 1, b: 1 },
    })

    const topicA = result.find((t) => t.key === 'a')!
    const topicB = result.find((t) => t.key === 'b')!
    expect(topicA.verbosityIndex).toBeGreaterThan(0)
    expect(topicB.verbosityIndex).toBe(0)
  })

  it('uses the per-topic analyzed-answer count as the readiness denominator', () => {
    const result = shapeTopicProfile({
      topics: [
        row({ normalizedName: 'a', klpIds: ['ka'] }),
        row({ normalizedName: 'b', klpIds: ['kb'] }),
      ],
      knowledge: {
        ka: { pKnown: 0.9, observations: 5 },
        kb: { pKnown: 0.9, observations: 5 },
      },
      tags: [
        tag({ klpId: 'ka', dimension: 'conciseness', type: 'rambling', significance: 6 }),
        tag({ klpId: 'kb', dimension: 'conciseness', type: 'rambling', significance: 6 }),
      ],
      // Same per-answer expression weight on both topics; only the analyzed
      // answer count differs. A shared/constant denominator would make
      // readiness identical across topics — it must not be.
      analyzedAnswersByTopic: { a: 1, b: 100 },
    })

    const topicA = result.find((t) => t.key === 'a')!
    const topicB = result.find((t) => t.key === 'b')!
    expect(topicA.readiness).not.toBeNull()
    expect(topicB.readiness).not.toBeNull()
    expect(topicA.readiness!).toBeLessThan(topicB.readiness!)
  })
})

describe('whole-answer tags reach readiness', () => {
  it('attributes a klpId-less tag to the topics of the card it was answered on', () => {
    // `no_thesis`/`disorganized`/`rambling` are whole-answer judgements and the
    // grading prompt tells the model to omit the KLP reference for them. Filtering
    // tags by klpId alone dropped every one of them, so a learner whose every
    // answer rambles scored perfect readiness.
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'a', klpIds: ['ka'], cardIds: ['c1'] })],
      knowledge: { ka: { pKnown: 0.9, observations: 5 } },
      tags: [
        tag({ klpId: null, cardId: 'c1', dimension: 'clarity', type: 'no_thesis', significance: 9 }),
      ],
      analyzedAnswersByTopic: { a: 1 },
    })
    expect(result[0].readiness).not.toBeNull()
    expect(result[0].readiness!).toBeLessThan(1)
  })

  it('does not leak a whole-answer tag into a topic the card does not belong to', () => {
    const result = shapeTopicProfile({
      topics: [
        row({ normalizedName: 'a', klpIds: ['ka'], cardIds: ['c1'] }),
        row({ normalizedName: 'b', klpIds: ['kb'], cardIds: ['c2'] }),
      ],
      knowledge: {},
      tags: [
        tag({ klpId: null, cardId: 'c1', dimension: 'clarity', type: 'no_thesis', significance: 9 }),
      ],
      analyzedAnswersByTopic: { a: 1, b: 1 },
    })
    expect(result.find((t) => t.key === 'a')!.readiness!).toBeLessThan(1)
    expect(result.find((t) => t.key === 'b')!.readiness).toBe(1)
  })

  it('keeps a whole-answer tag out of the signed verbosity index', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'a', klpIds: ['ka'], cardIds: ['c1'] })],
      knowledge: {},
      tags: [
        tag({ klpId: null, cardId: 'c1', dimension: 'conciseness', type: 'rambling', significance: 9 }),
      ],
      analyzedAnswersByTopic: { a: 1 },
    })
    // Counted as expression weight, but not as evidence of over-talking: with
    // no pKnown to test, whole-answer terseness could never balance it.
    expect(result[0].verbosityIndex).toBe(0)
    expect(result[0].readiness!).toBeLessThan(1)
  })
})

describe('toTopicRows', () => {
  it('flattens joined assignments into a de-duplicable KLP id list', () => {
    const rows = toTopicRows([
      {
        normalizedName: 'valuation',
        name: 'Valuation',
        color: '#3b82f6',
        assignments: [
          { card: { id: 'c1', klps: [{ id: 'k1' }, { id: 'k2' }] } },
          { card: { id: 'c2', klps: [{ id: 'k3' }] } },
        ],
      },
    ])
    expect(rows[0].klpIds).toEqual(['k1', 'k2', 'k3'])
    expect(rows[0].displayName).toBe('Valuation')
  })

  it('carries the card ids, which is all a whole-answer tag can be scoped by', () => {
    const rows = toTopicRows([
      {
        normalizedName: 'valuation',
        name: 'Valuation',
        color: null,
        assignments: [
          { card: { id: 'c1', klps: [{ id: 'k1' }] } },
          { card: { id: 'c2', klps: [] } },
        ],
      },
    ])
    // c2 has no KLPs at all — dropping it here would make every whole-answer
    // tag on that card invisible to readiness.
    expect(rows[0].cardIds).toEqual(['c1', 'c2'])
  })

  it('yields an empty klpIds list for a category whose cards have no KLPs', () => {
    const rows = toTopicRows([
      {
        normalizedName: 'dcf', name: 'DCF', color: null,
        assignments: [{ card: { id: 'c1', klps: [] } }],
      },
    ])
    expect(rows[0].klpIds).toEqual([])
    expect(rows[0].cardIds).toEqual(['c1'])
  })
})

describe('composite', () => {
  it('holds both grains so prompts can read either', () => {
    const cards = { setId: null, setTitle: null, weak: [], fading: [], strong: [], starred: [],
      recent: { byMode: [], graded: [], streakDays: 0 } } as LearnerCardProfile
    const composite = composeLearnerProfile(cards, [])
    expect(composite.cards).toBe(cards)
    expect(composite.topics).toEqual([])
  })
})
