import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_MASTERY_TOPIC_RANKS,
  ThresholdOverridesSchema,
  parseThresholds,
  resolveThresholds,
} from '@/lib/tuning/schema'
import { MAX_KLTS_PER_KLP } from '@/lib/ai/schemas'

describe('masteryTopicRanks', () => {
  it('defaults to counting every rank', () => {
    expect(DEFAULT_THRESHOLDS.masteryTopicRanks).toBe(DEFAULT_MASTERY_TOPIC_RANKS)
    expect(DEFAULT_MASTERY_TOPIC_RANKS).toBe(MAX_KLTS_PER_KLP)
  })

  it('accepts narrowing to the primary topic only', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 1 }).success).toBe(true)
  })

  it('rejects 0 — no rank counting means no topic could ever report knowledge', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 0 }).success).toBe(false)
  })

  it(`rejects more than ${MAX_KLTS_PER_KLP} — no KLP can carry that many`, () => {
    expect(
      ThresholdOverridesSchema.safeParse({ masteryTopicRanks: MAX_KLTS_PER_KLP + 1 }).success,
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
})
