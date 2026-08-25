import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_MASTERY_TOPIC_RANKS,
  MASTERY_TOPIC_RANKS_MAX,
  ThresholdOverridesSchema,
  parseThresholds,
  resolveThresholds,
} from '@/lib/tuning/schema'

// Pinned to the LITERAL 3, not derived from MAX_CONCEPTS_PER_KLP (2). The two
// are deliberately decoupled — narrowing this bound to track the concept cap
// would fail parsing on a stored `masteryTopicRanks: 3` and, because a bad
// blob here degrades to {}, silently discard every OTHER threshold override
// too. This test exists so that decoupling cannot silently regress.
const EXPECTED_MAX = 3

describe('masteryTopicRanks', () => {
  it('defaults to counting every rank', () => {
    expect(DEFAULT_THRESHOLDS.masteryTopicRanks).toBe(DEFAULT_MASTERY_TOPIC_RANKS)
    expect(DEFAULT_MASTERY_TOPIC_RANKS).toBe(EXPECTED_MAX)
  })

  it('is bounded by a literal 3, decoupled from the concept cap', () => {
    expect(MASTERY_TOPIC_RANKS_MAX).toBe(EXPECTED_MAX)
  })

  it('accepts narrowing to the primary topic only', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 1 }).success).toBe(true)
  })

  it('accepts a stored 3 — a harmless no-op once only ranks 1-2 exist', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 3 }).success).toBe(true)
  })

  it('rejects 0 — no rank counting means no topic could ever report knowledge', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 0 }).success).toBe(false)
  })

  it(`rejects more than ${EXPECTED_MAX} — no stored settings row can hold that many`, () => {
    expect(
      ThresholdOverridesSchema.safeParse({ masteryTopicRanks: EXPECTED_MAX + 1 }).success,
    ).toBe(false)
  })

  it('rejects a fractional rank', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 1.5 }).success).toBe(false)
  })

  it('survives a round trip through the stored blob', () => {
    expect(resolveThresholds(parseThresholds({ masteryTopicRanks: 1 })).masteryTopicRanks).toBe(1)
  })

  it('falls back to the default when the stored blob is corrupt', () => {
    // A bad settings row must never make the app unusable — same contract as
    // every other threshold.
    expect(resolveThresholds(parseThresholds('nonsense')).masteryTopicRanks).toBe(
      DEFAULT_MASTERY_TOPIC_RANKS,
    )
  })

  it('leaves the other thresholds at their defaults when only this one is set', () => {
    const resolved = resolveThresholds(parseThresholds({ masteryTopicRanks: 2 }))
    expect(resolved.minObservations).toBe(DEFAULT_THRESHOLDS.minObservations)
    expect(resolved.articulationMinPKnown).toBe(DEFAULT_THRESHOLDS.articulationMinPKnown)
  })

  it('a stored 3 does NOT wipe out sibling overrides in the same blob', () => {
    // The regression this guards: if masteryTopicRanks' bound had followed
    // MAX_CONCEPTS_PER_KLP down to 2, a legacy `3` would fail the .strict()
    // parse, and parseThresholds returns {} on ANY failure — discarding
    // minObservations too, not just this field.
    const resolved = resolveThresholds(
      parseThresholds({ masteryTopicRanks: 3, minObservations: 9 }),
    )
    expect(resolved.masteryTopicRanks).toBe(3)
    expect(resolved.minObservations).toBe(9)
  })
})
