import { describe, it, expect } from 'vitest'
import { computeArticulation, ARTICULATION_MIN_PKNOWN } from '@/lib/metrics/articulation'
import type { DerivedTag } from '@/lib/errors/derive'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

const NOW = new Date('2026-08-05T12:00:00.000Z')

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

const known = { klp1: { pKnown: 0.9, observations: 5 } }

describe('signed verbosity index', () => {
  it('is positive when the learner over-talks', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling' }), tag({ type: 'kitchen_sink' })],
      knowledge: known,
      analyzedAnswers: 2,
    })
    expect(result.verbosityIndex).toBeGreaterThan(0)
  })

  it('is negative when the learner under-talks on material they know', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: known,
      analyzedAnswers: 1,
    })
    expect(result.verbosityIndex).toBeLessThan(0)
  })

  it('is near zero when over- and under-talking cancel', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 6 }), tag({ type: 'too_terse', significance: 6 })],
      knowledge: known,
      analyzedAnswers: 1,
    })
    expect(result.verbosityIndex).toBe(0)
  })
})

describe('too_terse is conditioned on knowledge', () => {
  it('excludes too_terse from the index when pKnown is below the threshold', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: { klp1: { pKnown: 0.2, observations: 5 } },
      analyzedAnswers: 1,
    })
    expect(result.verbosityIndex).toBe(0)
    expect(result.knowledgeGapTerseness).toBe(1)
  })

  it('excludes too_terse when the KLP is below the observation floor', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: { klp1: { pKnown: 0.9, observations: 1 } },
      analyzedAnswers: 1,
    })
    expect(result.verbosityIndex).toBe(0)
    expect(result.knowledgeGapTerseness).toBe(1)
  })

  it('excludes a whole-answer tag with no klpId — there is no pKnown to test', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse', klpId: null })],
      knowledge: known,
      analyzedAnswers: 1,
    })
    expect(result.verbosityIndex).toBe(0)
  })

  it('does not call a whole-answer terseness a knowledge gap', () => {
    // `knowledgeGapTerseness` means "excluded BECAUSE they likely do not know
    // it". A whole-answer tag is excluded from the INDEX for a different
    // reason — no target — and is booked as expression evidence instead.
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse', klpId: null, significance: 9 })],
      knowledge: known,
      analyzedAnswers: 1,
    })
    expect(result.knowledgeGapTerseness).toBe(0)
    expect(result.readiness!).toBeLessThan(1)
  })

  it('still counts over-talking regardless of knowledge', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling' })],
      knowledge: { klp1: { pKnown: 0.1, observations: 5 } },
      analyzedAnswers: 1,
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
      analyzedAnswers: 1,
    })
    expect(result.verbosityIndex).toBe(0)
  })
})

describe('whole-answer tags count toward expression weight', () => {
  it('lowers readiness for a klpId-less clarity tag', () => {
    // `no_thesis`, `disorganized`, `incoherent_syntax` are whole-answer
    // judgements by nature. If they cannot move readiness, a learner whose
    // every answer is a shapeless ramble scores perfectly interview-ready.
    const result = computeArticulation({
      tags: [tag({ dimension: 'clarity', type: 'no_thesis', klpId: null, significance: 9 })],
      knowledge: {},
      analyzedAnswers: 1,
    })
    expect(result.readiness!).toBeLessThan(1)
  })

  it('lowers readiness for a klpId-less over-talk tag while leaving the index at zero', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling', klpId: null, significance: 9 })],
      knowledge: {},
      analyzedAnswers: 1,
    })
    expect(result.verbosityIndex).toBe(0)
    expect(result.readiness!).toBeLessThan(1)
  })

  it('weighs a whole-answer tag the same as a KLP-targeted one of equal significance', () => {
    const targeted = computeArticulation({
      tags: [tag({ dimension: 'clarity', type: 'disorganized', klpId: 'klp1', significance: 9 })],
      knowledge: known,
      analyzedAnswers: 3,
    })
    const wholeAnswer = computeArticulation({
      tags: [tag({ dimension: 'clarity', type: 'disorganized', klpId: null, significance: 9 })],
      knowledge: known,
      analyzedAnswers: 3,
    })
    expect(wholeAnswer.readiness).toBe(targeted.readiness)
  })
})

describe('readiness', () => {
  it('is null with zero analyzed answers rather than a fabricated score', () => {
    expect(computeArticulation({ tags: [], knowledge: {}, analyzedAnswers: 0 }).readiness).toBeNull()
  })

  it('is 1.0 (clean) when analyzedAnswers > 0 but no expression tags', () => {
    expect(computeArticulation({ tags: [], knowledge: {}, analyzedAnswers: 5 }).readiness).toBe(1)
  })

  it('is identical for same per-answer weight across 2 and 20 analyzed answers', () => {
    const twoAnswers = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 12 })],
      knowledge: known,
      analyzedAnswers: 2,
    })
    const twentyAnswers = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 120 })],
      knowledge: known,
      analyzedAnswers: 20,
    })
    // Both have per-answer weight of 6, so same readiness
    expect(twoAnswers.readiness).toBe(twentyAnswers.readiness)
  })

  it('is lower for a learner with heavy clarity and conciseness problems', () => {
    const clean = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 1 })],
      knowledge: known,
      analyzedAnswers: 1,
    })
    const messy = computeArticulation({
      tags: [
        tag({ type: 'rambling', significance: 9 }),
        tag({ dimension: 'clarity', type: 'disorganized', significance: 9 }),
      ],
      knowledge: known,
      analyzedAnswers: 1,
    })
    expect(messy.readiness!).toBeLessThan(clean.readiness!)
  })
})

describe('tunable thresholds (Spec 3B)', () => {
  const terseTag = {
    attemptId: 'att1', cardId: 'c1', dimension: 'conciseness' as const,
    type: 'too_terse', klpId: 'k1', relevance: 3, starred: false,
    magnitude: 5, storedSeverity: 3, storedSignificance: 5,
    mode: 'quiz-sa' as const, createdAt: new Date('2026-08-06T00:00:00Z'),
    severity: 3, repeatBonus: 0, significance: 5, isLegacy: false,
  }

  it('books terseness as a knowledge gap when the KLP is below the observation floor', () => {
    const out = computeArticulation({
      tags: [terseTag],
      knowledge: { k1: { pKnown: 0.9, observations: 2 } },
      analyzedAnswers: 1,
    })
    expect(out.knowledgeGapTerseness).toBe(1)
    expect(out.verbosityIndex).toBe(0)
  })

  it('LOWERING minObservations makes that same tag count as an expression gap', () => {
    // The whole point of the knob: at the shipped floor of 3 this learner's
    // two observations are invisible; at 1 they are provisional evidence.
    const out = computeArticulation({
      tags: [terseTag],
      knowledge: { k1: { pKnown: 0.9, observations: 2 } },
      analyzedAnswers: 1,
      thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
    })
    expect(out.knowledgeGapTerseness).toBe(0)
    expect(out.verbosityIndex).toBe(-5)
  })

  it('RAISING articulationMinPKnown reclassifies an expression gap as a knowledge gap', () => {
    const base = { tags: [terseTag], knowledge: { k1: { pKnown: 0.7, observations: 5 } }, analyzedAnswers: 1 }
    expect(computeArticulation(base).verbosityIndex).toBe(-5)
    expect(
      computeArticulation({ ...base, thresholds: { ...DEFAULT_THRESHOLDS, articulationMinPKnown: 0.8 } })
        .knowledgeGapTerseness,
    ).toBe(1)
  })

  it('LOWERING readinessWeightPerAnswer makes the same errors read as less ready', () => {
    const base = {
      tags: [{ ...terseTag, dimension: 'clarity' as const, type: 'no_thesis', klpId: null }],
      knowledge: {},
      analyzedAnswers: 1,
    }
    const shipped = computeArticulation(base).readiness!
    const strict = computeArticulation({
      ...base, thresholds: { ...DEFAULT_THRESHOLDS, readinessWeightPerAnswer: 6 },
    }).readiness!
    expect(strict).toBeLessThan(shipped)
  })

  it('omitting thresholds reproduces the shipped constants exactly', () => {
    const base = { tags: [terseTag], knowledge: { k1: { pKnown: 0.9, observations: 5 } }, analyzedAnswers: 2 }
    expect(computeArticulation(base)).toEqual(
      computeArticulation({ ...base, thresholds: DEFAULT_THRESHOLDS }),
    )
  })
})
