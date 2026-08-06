import { describe, it, expect } from 'vitest'
import { computeArticulation, ARTICULATION_MIN_PKNOWN } from '@/lib/metrics/articulation'
import type { DerivedTag } from '@/lib/errors/derive'

const NOW = new Date('2026-08-05T12:00:00.000Z')

const tag = (o: Partial<DerivedTag> = {}): DerivedTag => ({
  attemptId: 'a1',
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

const known = { klp1: { pKnown: 0.9, observations: 5 } }

describe('signed verbosity index', () => {
  it('is positive when the learner over-talks', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling' }), tag({ type: 'kitchen_sink' })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBeGreaterThan(0)
  })

  it('is negative when the learner under-talks on material they know', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBeLessThan(0)
  })

  it('is near zero when over- and under-talking cancel', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 6 }), tag({ type: 'too_terse', significance: 6 })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBe(0)
  })
})

describe('too_terse is conditioned on knowledge', () => {
  it('excludes too_terse from the index when pKnown is below the threshold', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: { klp1: { pKnown: 0.2, observations: 5 } },
    })
    expect(result.verbosityIndex).toBe(0)
    expect(result.knowledgeGapTerseness).toBe(1)
  })

  it('excludes too_terse when the KLP is below the observation floor', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: { klp1: { pKnown: 0.9, observations: 1 } },
    })
    expect(result.verbosityIndex).toBe(0)
    expect(result.knowledgeGapTerseness).toBe(1)
  })

  it('excludes a whole-answer tag with no klpId — there is no pKnown to test', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse', klpId: null })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBe(0)
  })

  it('still counts over-talking regardless of knowledge', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling' })],
      knowledge: { klp1: { pKnown: 0.1, observations: 5 } },
    })
    expect(result.verbosityIndex).toBeGreaterThan(0)
    expect(ARTICULATION_MIN_PKNOWN).toBe(0.6)
  })
})

describe('clarity tags do not affect verbosity index', () => {
  it('clarity tags only contribute to readiness, not to the index', () => {
    const result = computeArticulation({
      tags: [tag({ dimension: 'clarity', type: 'disorganized', significance: 9 })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBe(0)
  })
})

describe('readiness', () => {
  it('is null with no analyzed short-answer evidence rather than a fabricated score', () => {
    expect(computeArticulation({ tags: [], knowledge: {} }).readiness).toBeNull()
  })

  it('is lower for a learner with heavy clarity and conciseness problems', () => {
    const clean = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 1 })],
      knowledge: known,
    })
    const messy = computeArticulation({
      tags: [
        tag({ type: 'rambling', significance: 9 }),
        tag({ dimension: 'clarity', type: 'disorganized', significance: 9 }),
      ],
      knowledge: known,
    })
    expect(messy.readiness!).toBeLessThan(clean.readiness!)
  })
})
