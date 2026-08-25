import { describe, it, expect } from 'vitest'
import { kltRowsToTopicRows, shapeTopicProfile } from '@/lib/memory/topic-profile'

const link = (klpId: string, rank: number, supersededAt: Date | null = null) => ({
  rank,
  klp: { id: klpId, supersededAt, cardId: `card-${klpId}` },
})

describe('kltRowsToTopicRows', () => {
  it('splits live from superseded KLPs, as category rows do', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1), link('b', 1, new Date())] }],
      3,
    )
    expect(row.klpIds).toEqual(['a'])
    expect(row.supersededKlpIds).toEqual(['b'])
  })

  it('includes every rank at the default maxRank', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1), link('b', 3)] }],
      3,
    )
    expect([...row.klpIds].sort()).toEqual(['a', 'b'])
  })

  it('drops ranks above maxRank when the knob is narrowed', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1), link('b', 2)] }],
      1,
    )
    expect(row.klpIds).toEqual(['a'])
  })

  it('carries cardIds so whole-answer tags can still be attributed', () => {
    // no_thesis / rambling tags carry no klpId; without cardIds they would be
    // dropped and a learner whose every answer rambles would score perfectly.
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1)] }],
      3,
    )
    expect(row.cardIds).toEqual(['card-a'])
  })

  it('never emits a topic whose links are all superseded', () => {
    expect(
      kltRowsToTopicRows(
        [{ normalizedName: 'dead', name: 'Dead', links: [link('a', 1, new Date())] }],
        3,
      ),
    ).toEqual([])
  })

  it('has no colour — KLTs are AI-derived, only categories are user-coloured', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1)] }],
      3,
    )
    expect(row.color).toBeNull()
  })

  it('dedupes a KLP linked twice at different ranks', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1), link('a', 2)] }],
      3,
    )
    expect(row.klpIds).toEqual(['a'])
  })

  it('feeds shapeTopicProfile unchanged, so both axes score identically', () => {
    // The whole point of reusing TopicRow: knowledge/readiness/verbosity come
    // from one implementation, not two that can drift.
    const rows = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1), link('b', 2)] }],
      3,
    )
    const [topic] = shapeTopicProfile({
      topics: rows,
      knowledge: {
        a: { pKnown: 0.8, observations: 5 },
        b: { pKnown: 0.4, observations: 5 },
      },
      tags: [],
      analyzedAnswersByTopic: { wacc: 4 },
      thresholds: {
        minObservations: 3,
        articulationMinPKnown: 0.6,
        readinessWeightPerAnswer: 4,
        masteryTopicRanks: 3,
      },
    })
    expect(topic.name).toBe('WACC')
    expect(topic.klpCount).toBe(2)
    expect(topic.knowledge).toBeCloseTo(0.6)
  })
})
