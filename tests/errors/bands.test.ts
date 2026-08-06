import { describe, it, expect } from 'vitest'
import { DEFAULT_BANDS, MC_TF_MAGNITUDE, resolveSeverity } from '@/lib/errors/bands'
import { CORRUPTION_SEVERITY } from '@/lib/errors/severity'
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES } from '@/lib/errors/taxonomy'

describe('band table completeness', () => {
  it('covers every type in all three closed vocabularies', () => {
    const all = [...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES]
    for (const type of all) {
      expect(DEFAULT_BANDS[type], `missing band for ${type}`).toBeDefined()
    }
  })

  it('has floor <= ceiling and stays within 1-5 for every band', () => {
    for (const [type, [floor, ceiling]] of Object.entries(DEFAULT_BANDS)) {
      expect(floor, type).toBeLessThanOrEqual(ceiling)
      expect(floor, type).toBeGreaterThanOrEqual(1)
      expect(ceiling, type).toBeLessThanOrEqual(5)
    }
  })
})

describe('MC/TF no-op property', () => {
  it('reproduces CORRUPTION_SEVERITY exactly for multiple choice at full magnitude', () => {
    for (const [corruption, expected] of Object.entries(CORRUPTION_SEVERITY)) {
      const actual = resolveSeverity({
        type: corruption,
        magnitude: MC_TF_MAGNITUDE,
        mode: 'quiz-mc',
      })
      expect(actual, corruption).toBe(expected)
    }
  })

  it('reproduces the true/false one-point dock', () => {
    for (const [corruption, rank] of Object.entries(CORRUPTION_SEVERITY)) {
      const actual = resolveSeverity({
        type: corruption,
        magnitude: MC_TF_MAGNITUDE,
        mode: 'quiz-tf',
      })
      expect(actual, corruption).toBe(Math.max(1, rank - 1))
    }
  })
})

describe('magnitude interpolation', () => {
  it('returns the floor at magnitude 1 and the ceiling at magnitude 10', () => {
    expect(resolveSeverity({ type: 'inversion', magnitude: 1, mode: 'quiz-sa' })).toBe(2)
    expect(resolveSeverity({ type: 'inversion', magnitude: 10, mode: 'quiz-sa' })).toBe(5)
  })

  it('lets a severe ramble outrank a mild redundancy', () => {
    const ramble = resolveSeverity({ type: 'rambling', magnitude: 10, mode: 'quiz-sa' })
    const redundancy = resolveSeverity({ type: 'redundancy', magnitude: 1, mode: 'quiz-sa' })
    expect(ramble).toBeGreaterThan(redundancy)
  })

  it('keeps kitchen_sink above rambling at every magnitude pairing', () => {
    for (let m = 1; m <= 10; m++) {
      const sink = resolveSeverity({ type: 'kitchen_sink', magnitude: 1, mode: 'quiz-sa' })
      const ramble = resolveSeverity({ type: 'rambling', magnitude: m, mode: 'quiz-sa' })
      expect(sink, `magnitude ${m}`).toBeGreaterThanOrEqual(ramble)
    }
  })

  it('clamps an unknown type to the neutral default band', () => {
    const result = resolveSeverity({ type: 'not_a_real_type', magnitude: 10, mode: 'quiz-sa' })
    expect(result).toBeGreaterThanOrEqual(1)
    expect(result).toBeLessThanOrEqual(5)
  })
})
