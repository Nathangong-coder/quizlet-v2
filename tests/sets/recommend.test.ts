import { describe, it, expect } from 'vitest'
import {
  pickWeakCategories,
  rankRecommendations,
  diagnoseRecommendEmpty,
  RECOMMEND_EMPTY_COPY,
  MIN_CARDS_PER_CATEGORY,
  WEAK_CEILING,
  type CandidateSet,
} from '@/lib/sets/recommend'
import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'

const topic = (over: Partial<LearnerTopicProfile> = {}): LearnerTopicProfile => ({
  key: 'valuation',
  name: 'Valuation',
  color: null,
  depth: null,
  parentKey: null,
  klpCount: 10,
  measuredKlpCount: 10,
  knowledge: 0.3,
  verbosityIndex: 0,
  knowledgeGapTerseness: 0,
  readiness: 0.5,
  ...over,
})

const candidate = (over: Partial<CandidateSet> = {}): CandidateSet => ({
  id: 's1',
  title: 'DCF Drills',
  ownerHandle: 'alice',
  cardCount: 40,
  categoryCounts: { valuation: 12 },
  ...over,
})

describe('pickWeakCategories', () => {
  it('keeps only topics with measured knowledge, weakest first', () => {
    const out = pickWeakCategories([
      topic({ key: 'a', knowledge: 0.6 }),
      topic({ key: 'b', knowledge: 0.2 }),
    ])
    expect(out.map((w) => w.key)).toEqual(['b', 'a'])
  })

  it('DROPS a topic with null knowledge rather than treating it as zero', () => {
    // Null means no KLP cleared the learner's own observation floor — no
    // evidence, not bad evidence. Reading it as 0 would make every untouched
    // topic the learner's single weakest area and drive the whole ranking off
    // topics nobody has measured.
    expect(pickWeakCategories([topic({ knowledge: null })])).toEqual([])
  })

  it('drops topics that are already strong', () => {
    expect(pickWeakCategories([topic({ knowledge: 0.95 })])).toEqual([])
  })

  it('treats the ceiling as exclusive', () => {
    expect(pickWeakCategories([topic({ knowledge: WEAK_CEILING })])).toEqual([])
    expect(pickWeakCategories([topic({ knowledge: WEAK_CEILING - 0.01 })])).toHaveLength(1)
  })

  it('returns an empty array for no topics', () => {
    expect(pickWeakCategories([])).toEqual([])
  })
})

describe('rankRecommendations', () => {
  const weak = [{ key: 'valuation', name: 'Valuation', knowledge: 0.2 }]

  it('names the reason on every recommendation', () => {
    // The cheapest and most important of the three mitigations. Cross-user
    // category matching is a string match wearing a concept's clothing; naming
    // the match is what lets a learner see a wrong one AS wrong rather than
    // trusting a ranking they cannot inspect.
    const [r] = rankRecommendations(weak, [candidate()])
    expect(r.because).toContain('Valuation')
  })

  it(`requires at least ${MIN_CARDS_PER_CATEGORY} cards in the matching category`, () => {
    // A one-card coincidence must not surface a whole set.
    const thin = candidate({ categoryCounts: { valuation: MIN_CARDS_PER_CATEGORY - 1 } })
    expect(rankRecommendations(weak, [thin])).toEqual([])

    const enough = candidate({ categoryCounts: { valuation: MIN_CARDS_PER_CATEGORY } })
    expect(rankRecommendations(weak, [enough])).toHaveLength(1)
  })

  it('ranks the weakest matching category first', () => {
    const out = rankRecommendations(
      [
        { key: 'accounting', name: 'Accounting', knowledge: 0.6 },
        { key: 'valuation', name: 'Valuation', knowledge: 0.1 },
      ],
      [
        candidate({ id: 'acc', categoryCounts: { accounting: 10 } }),
        candidate({ id: 'val', categoryCounts: { valuation: 10 } }),
      ],
    )
    // The caller passes weak categories already sorted; ranking follows that
    // order rather than re-deriving it.
    expect(out.map((r) => r.setId)).toEqual(['acc', 'val'])
  })

  it('returns nothing when no category matches', () => {
    expect(rankRecommendations(weak, [candidate({ categoryCounts: { spanish: 50 } })])).toEqual(
      [],
    )
  })

  it('recommends each set at most once', () => {
    // A set carrying three of your weak categories is not three
    // recommendations; listing it repeatedly lets one set crowd out every
    // other.
    const out = rankRecommendations(
      [
        { key: 'valuation', name: 'Valuation', knowledge: 0.1 },
        { key: 'accounting', name: 'Accounting', knowledge: 0.2 },
      ],
      [candidate({ categoryCounts: { valuation: 10, accounting: 10 } })],
    )
    expect(out).toHaveLength(1)
  })

  it('attributes a set to the FIRST (weakest) category it matches', () => {
    const out = rankRecommendations(
      [
        { key: 'valuation', name: 'Valuation', knowledge: 0.1 },
        { key: 'accounting', name: 'Accounting', knowledge: 0.2 },
      ],
      [candidate({ categoryCounts: { valuation: 10, accounting: 10 } })],
    )
    expect(out[0].because).toContain('Valuation')
    expect(out[0].because).not.toContain('Accounting')
  })

  it('returns nothing when the learner has no weak categories', () => {
    expect(rankRecommendations([], [candidate()])).toEqual([])
  })
})

describe('diagnoseRecommendEmpty', () => {
  it('distinguishes all four causes', () => {
    // Four empty states, not one, mirroring diagnoseEmptyState. The remedies
    // differ — publish something, categorize your cards, study more, or simply
    // no overlap — and merging them produces the "is this broken?" confusion
    // the 3B gate hit twice.
    expect(diagnoseRecommendEmpty({ publicSetCount: 0, topicCount: 5, weakCount: 2 })).toBe(
      'no_public_sets',
    )
    expect(diagnoseRecommendEmpty({ publicSetCount: 9, topicCount: 0, weakCount: 0 })).toBe(
      'no_categorized_cards',
    )
    expect(diagnoseRecommendEmpty({ publicSetCount: 9, topicCount: 5, weakCount: 0 })).toBe(
      'below_floor',
    )
    expect(diagnoseRecommendEmpty({ publicSetCount: 9, topicCount: 5, weakCount: 2 })).toBe(
      'no_match',
    )
  })

  it('gives every cause a distinct remedy', () => {
    const copies = Object.values(RECOMMEND_EMPTY_COPY)
    expect(new Set(copies).size).toBe(copies.length)
    for (const c of copies) expect(c.length).toBeGreaterThan(0)
  })
})
