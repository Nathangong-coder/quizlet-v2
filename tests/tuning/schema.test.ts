import { describe, it, expect } from 'vitest'
import {
  parseBandOverrides, resolveBands,
  parseThresholds, resolveThresholds, DEFAULT_THRESHOLDS,
  parseStrategy, STRATEGY_KEYS, TUNING_VERSION, shapeTuning,
} from '@/lib/tuning/schema'
import { DEFAULT_BANDS } from '@/lib/errors/bands'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'
import { ARTICULATION_MIN_PKNOWN, READINESS_WEIGHT_PER_ANSWER } from '@/lib/metrics/articulation'

describe('parseBandOverrides', () => {
  it('accepts a sparse map of valid bands', () => {
    expect(parseBandOverrides({ inversion: [1, 4] })).toEqual({ inversion: [1, 4] })
  })

  it('returns an empty override map for null or undefined', () => {
    expect(parseBandOverrides(null)).toEqual({})
    expect(parseBandOverrides(undefined)).toEqual({})
  })

  it('falls back to no overrides on a corrupt blob rather than throwing', () => {
    expect(parseBandOverrides({ inversion: 'not a band' })).toEqual({})
    expect(parseBandOverrides('garbage')).toEqual({})
  })

  it('rejects an inverted band rather than clamping it', () => {
    expect(parseBandOverrides({ inversion: [4, 2] })).toEqual({})
  })

  it('rejects out-of-range values rather than clamping them', () => {
    expect(parseBandOverrides({ inversion: [0, 4] })).toEqual({})
    expect(parseBandOverrides({ inversion: [1, 6] })).toEqual({})
  })

  it('rejects non-integer values', () => {
    expect(parseBandOverrides({ inversion: [1.5, 4] })).toEqual({})
  })

  it('rejects a type outside the closed vocabularies', () => {
    expect(parseBandOverrides({ not_a_real_type: [1, 4] })).toEqual({})
  })
})

describe('resolveBands', () => {
  it('returns the defaults untouched with no overrides', () => {
    expect(resolveBands({})).toEqual(DEFAULT_BANDS)
  })

  it('overrides only the named type and leaves every other default intact', () => {
    const resolved = resolveBands({ inversion: [1, 2] })
    expect(resolved.inversion).toEqual([1, 2])
    expect(resolved.conflation).toEqual(DEFAULT_BANDS.conflation)
  })

  it('always returns a FULL table — a partial one silently downgrades every unlisted type', () => {
    // resolveSeverity does `bands ?? DEFAULT_BANDS`, a replacement not a merge,
    // so any type missing here resolves to FALLBACK_BAND [1,3] instead of its
    // default. This assertion is the guard against handing one out.
    expect(Object.keys(resolveBands({ inversion: [1, 2] })).sort())
      .toEqual(Object.keys(DEFAULT_BANDS).sort())
  })

  it('does not mutate DEFAULT_BANDS', () => {
    const before = DEFAULT_BANDS.inversion
    resolveBands({ inversion: [1, 2] })
    expect(DEFAULT_BANDS.inversion).toBe(before)
  })
})

describe('DEFAULT_THRESHOLDS', () => {
  it('is DERIVED from the shipped constants, never a second copy of the numbers', () => {
    // Same rule guessRate() follows against EVIDENCE_STRENGTH: writing 3 / 0.6 /
    // 12 here a second time is the persisted-value-in-two-places drift class.
    expect(DEFAULT_THRESHOLDS.minObservations).toBe(MIN_OBSERVATIONS)
    expect(DEFAULT_THRESHOLDS.articulationMinPKnown).toBe(ARTICULATION_MIN_PKNOWN)
    expect(DEFAULT_THRESHOLDS.readinessWeightPerAnswer).toBe(READINESS_WEIGHT_PER_ANSWER)
  })
})

describe('parseThresholds', () => {
  it('accepts a sparse map', () => {
    expect(parseThresholds({ minObservations: 1 })).toEqual({ minObservations: 1 })
  })

  it('returns an empty map for null or a corrupt blob', () => {
    expect(parseThresholds(null)).toEqual({})
    expect(parseThresholds({ minObservations: 'many' })).toEqual({})
    expect(parseThresholds('garbage')).toEqual({})
  })

  it('rejects minObservations below 1 — zero observations is not evidence', () => {
    expect(parseThresholds({ minObservations: 0 })).toEqual({})
    expect(parseThresholds({ minObservations: 2.5 })).toEqual({})
  })

  it('rejects an articulation pKnown outside 0-1', () => {
    expect(parseThresholds({ articulationMinPKnown: 1.5 })).toEqual({})
    expect(parseThresholds({ articulationMinPKnown: -0.1 })).toEqual({})
  })

  it('rejects a readiness weight of zero — readiness divides by it', () => {
    expect(parseThresholds({ readinessWeightPerAnswer: 0 })).toEqual({})
    expect(parseThresholds({ readinessWeightPerAnswer: -3 })).toEqual({})
  })

  it('rejects an unknown key', () => {
    expect(parseThresholds({ minObservations: 1, bogus: 4 })).toEqual({})
  })
})

describe('resolveThresholds', () => {
  it('fills every unset key from the defaults', () => {
    const resolved = resolveThresholds({ minObservations: 1 })
    expect(resolved.minObservations).toBe(1)
    expect(resolved.articulationMinPKnown).toBe(DEFAULT_THRESHOLDS.articulationMinPKnown)
    expect(resolved.readinessWeightPerAnswer).toBe(DEFAULT_THRESHOLDS.readinessWeightPerAnswer)
  })

  it('returns the defaults untouched with no overrides', () => {
    expect(resolveThresholds({})).toEqual(DEFAULT_THRESHOLDS)
  })
})

describe('parseStrategy', () => {
  it('accepts every documented key', () => {
    for (const key of STRATEGY_KEYS) expect(parseStrategy(key)).toBe(key)
  })

  it('falls back to balanced on an unknown or missing value', () => {
    expect(parseStrategy('nonsense')).toBe('balanced')
    expect(parseStrategy(null)).toBe('balanced')
  })

  it('pins the current tuning version', () => {
    expect(TUNING_VERSION).toBe(1)
  })
})

describe('shapeTuning', () => {
  it('returns balanced with no overrides when the user has no row', () => {
    expect(shapeTuning(null)).toEqual({
      strategy: 'balanced',
      bandOverrides: {},
      thresholdOverrides: {},
      studyScope: { setIds: [], categoryKeys: [] },
    })
  })

  it('reads a stored strategy and both override blobs', () => {
    const shaped = shapeTuning({
      strategy: 'polish_near_ready',
      bands: { inversion: [1, 3] },
      thresholds: { minObservations: 1 },
      studyScope: null,
    })
    expect(shaped.strategy).toBe('polish_near_ready')
    expect(shaped.bandOverrides).toEqual({ inversion: [1, 3] })
    expect(shaped.thresholdOverrides).toEqual({ minObservations: 1 })
  })

  it('falls back to balanced on an unrecognised stored strategy', () => {
    expect(
      shapeTuning({ strategy: 'retired_key', bands: null, thresholds: null, studyScope: null })
        .strategy,
    ).toBe('balanced')
  })

  it('drops one corrupt blob without touching the other', () => {
    const shaped = shapeTuning({
      strategy: 'follow_forgetting',
      bands: { inversion: [9, 9] },
      thresholds: { minObservations: 1 },
      studyScope: null,
    })
    expect(shaped.strategy).toBe('follow_forgetting')
    expect(shaped.bandOverrides).toEqual({})
    expect(shaped.thresholdOverrides).toEqual({ minObservations: 1 })
  })

  it('reads a stored study scope alongside the other three fields', () => {
    const shaped = shapeTuning({
      strategy: 'balanced',
      bands: null,
      thresholds: null,
      studyScope: { setIds: ['set-a'], categoryKeys: ['accounting'] },
    })
    expect(shaped.studyScope).toEqual({ setIds: ['set-a'], categoryKeys: ['accounting'] })
  })

  it('a corrupt study scope discards NOTHING else', () => {
    // Four fields now degrade independently. A single try/catch around the
    // whole row would let one bad blob wipe three good settings — and the user
    // would have no way to tell which one broke.
    const shaped = shapeTuning({
      strategy: 'follow_forgetting',
      bands: { inversion: [1, 3] },
      thresholds: { minObservations: 1 },
      studyScope: { setIds: 'not-an-array' },
    })
    expect(shaped.studyScope).toEqual({ setIds: [], categoryKeys: [] })
    expect(shaped.strategy).toBe('follow_forgetting')
    expect(shaped.bandOverrides).toEqual({ inversion: [1, 3] })
    expect(shaped.thresholdOverrides).toEqual({ minObservations: 1 })
  })

  it('keeps overrides sparse — it never returns the full default table', () => {
    const shaped = shapeTuning({
      strategy: 'balanced',
      bands: { inversion: [1, 3] },
      thresholds: null,
      studyScope: null,
    })
    expect(Object.keys(shaped.bandOverrides)).toEqual(['inversion'])
  })
})
