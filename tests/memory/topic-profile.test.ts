import { describe, it, expect } from 'vitest'
import { shapeTopicProfile, composeLearnerProfile, toTopicRows } from '@/lib/memory/topic-profile'
import type { TopicRow } from '@/lib/memory/topic-profile'
import type { LearnerCardProfile } from '@/lib/memory/profile'
import type { DerivedTag } from '@/lib/errors/derive'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

const NOW = new Date('2026-08-05T12:00:00.000Z')

const row = (o: Partial<TopicRow> & { normalizedName: string }): TopicRow => ({
  displayName: 'Valuation',
  color: '#3b82f6',
  klpIds: ['klp1'],
  supersededKlpIds: [],
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

const live = (id: string) => ({ id, supersededAt: null })
const retired = (id: string) => ({ id, supersededAt: new Date('2026-07-01T00:00:00.000Z') })

describe('toTopicRows', () => {
  it('flattens joined assignments into a de-duplicable KLP id list', () => {
    const rows = toTopicRows([
      {
        normalizedName: 'valuation',
        name: 'Valuation',
        color: '#3b82f6',
        assignments: [
          { card: { id: 'c1', klps: [live('k1'), live('k2')] } },
          { card: { id: 'c2', klps: [live('k3')] } },
        ],
      },
    ])
    expect(rows[0].klpIds).toEqual(['k1', 'k2', 'k3'])
    expect(rows[0].displayName).toBe('Valuation')
  })

  it('splits superseded KLPs out of klpIds without discarding them (B7)', () => {
    const rows = toTopicRows([
      {
        normalizedName: 'valuation',
        name: 'Valuation',
        color: null,
        assignments: [
          { card: { id: 'c1', klps: [live('k-new'), retired('k-old')] } },
        ],
      },
    ])
    // Live-only drives knowledge and klpCount; the retired id survives so a
    // historical tag naming it can still be attributed to this topic.
    expect(rows[0].klpIds).toEqual(['k-new'])
    expect(rows[0].supersededKlpIds).toEqual(['k-old'])
  })

  it('carries the card ids, which is all a whole-answer tag can be scoped by', () => {
    const rows = toTopicRows([
      {
        normalizedName: 'valuation',
        name: 'Valuation',
        color: null,
        assignments: [
          { card: { id: 'c1', klps: [live('k1')] } },
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

describe('readiness keeps tags whose target KLP was superseded (B7)', () => {
  it('attributes a tag on a retired KLP to the topic that KLP belonged to', () => {
    // The numerator filtered KLP-targeted tags through the topic's LIVE KLP
    // set, but a historical tag references the version that was live when the
    // answer was given. Editing a card supersedes its KLPs, so every past tag
    // on it silently left the numerator while its answers stayed in the
    // denominator — readiness jumped toward 1.0 with no change in behaviour.
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k-new'], supersededKlpIds: ['k-old'] })],
      knowledge: {},
      tags: [tag({ klpId: 'k-old', type: 'rambling', dimension: 'conciseness' })],
      analyzedAnswersByTopic: { dcf: 4 },
    })

    expect(result[0].readiness).not.toBeNull()
    expect(result[0].readiness!).toBeLessThan(1)
  })

  it('still counts only LIVE KLPs toward knowledge and klpCount', () => {
    // Only tag ATTRIBUTION widens. A superseded KLP belongs to an older
    // version of the card, so its evidence must not move current knowledge.
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k-new'], supersededKlpIds: ['k-old'] })],
      knowledge: {
        'k-new': { pKnown: 0.9, observations: 5 },
        'k-old': { pKnown: 0.1, observations: 5 },
      },
      tags: [],
      analyzedAnswersByTopic: { dcf: 4 },
    })

    expect(result[0].klpCount).toBe(1)
    expect(result[0].knowledge).toBeCloseTo(0.9, 10)
  })

  it('does not claim a tag on a KLP belonging to no topic in scope', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k-new'], supersededKlpIds: [] })],
      knowledge: {},
      tags: [tag({ klpId: 'k-elsewhere', cardId: 'other-card' })],
      analyzedAnswersByTopic: { dcf: 4 },
    })

    expect(result[0].readiness).toBe(1)
  })
})

describe('tunable observation floor (Spec 3B)', () => {
  const topic = {
    normalizedName: 'valuation', displayName: 'Valuation', color: null,
    klpIds: ['k1'], supersededKlpIds: [], cardIds: ['c1'],
  }

  it('reports null knowledge for a KLP below the shipped floor', () => {
    const [out] = shapeTopicProfile({
      topics: [topic],
      knowledge: { k1: { pKnown: 0.8, observations: 1 } },
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(out.knowledge).toBeNull()
  })

  it('reports that knowledge once the learner lowers the floor', () => {
    // This is the live-database case: every KLP seen at most once, so at the
    // shipped floor of 3 zero topics report any knowledge at all.
    const [out] = shapeTopicProfile({
      topics: [topic],
      knowledge: { k1: { pKnown: 0.8, observations: 1 } },
      tags: [],
      analyzedAnswersByTopic: {},
      thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
    })
    expect(out.knowledge).toBeCloseTo(0.8)
  })

  it('forwards thresholds down to computeArticulation, not just its own filter', () => {
    // A partial thread — honouring the floor for knowledge but not for
    // articulation — is the failure this asserts against.
    const [out] = shapeTopicProfile({
      topics: [topic],
      knowledge: { k1: { pKnown: 0.9, observations: 1 } },
      tags: [{
        attemptId: 'att1', cardId: 'c1', dimension: 'conciseness', type: 'too_terse',
        klpId: 'k1', relevance: 3, starred: false, magnitude: 5, storedSeverity: 3,
        storedSignificance: 5, mode: 'quiz-sa', createdAt: new Date('2026-08-06T00:00:00Z'),
        severity: 3, repeatBonus: 0, significance: 5, isLegacy: false,
      }],
      analyzedAnswersByTopic: { valuation: 1 },
      thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
    })
    expect(out.knowledgeGapTerseness).toBe(0)
    expect(out.verbosityIndex).toBe(-5)
  })
})

describe('parentKey on the profile', () => {
  it('carries through, first non-undefined wins, mirroring depth', () => {
    const out = shapeTopicProfile({
      topics: [
        { normalizedName: 'a', displayName: 'A', color: null, depth: 0, parentKey: null, klpIds: ['k1'], supersededKlpIds: [], cardIds: ['c1'] },
        { normalizedName: 'b', displayName: 'B', color: null, depth: 1, parentKey: 'a', klpIds: ['k2'], supersededKlpIds: [], cardIds: ['c1'] },
      ],
      knowledge: {},
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(out.find((t) => t.key === 'b')!.parentKey).toBe('a')
    expect(out.find((t) => t.key === 'a')!.parentKey).toBeNull()
  })

  it('is null for a user-authored category, which has no tree position', () => {
    const out = shapeTopicProfile({
      topics: [
        { normalizedName: 'vocab', displayName: 'Vocab', color: '#fff', klpIds: ['k1'], supersededKlpIds: [], cardIds: ['c1'] },
      ],
      knowledge: {},
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(out[0].parentKey).toBeNull()
  })
})
