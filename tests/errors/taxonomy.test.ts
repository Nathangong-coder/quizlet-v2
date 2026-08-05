import { describe, it, expect } from 'vitest'
import { CORRUPTIONS } from '@/lib/quiz/options'
import {
  ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES,
  DIMENSIONS, DIM_WEIGHTS, typesForDimension, validateTagType,
} from '@/lib/errors/taxonomy'

describe('the CORRUPTIONS subset invariant', () => {
  it('every corruption is a valid accuracy error type', () => {
    // MC/TF write a distractor's `corruption` DIRECTLY as an error `type`.
    // If these lists drift, those tags land on a type the taxonomy does not
    // know and NOTHING throws — `type` is a String column. This test turns a
    // silent data-corruption bug into a build failure.
    for (const c of CORRUPTIONS) {
      expect(ACCURACY_TYPES).toContain(c)
    }
  })

  it('is a STRICT subset — accuracy has types no corruption can express', () => {
    // omission/incomplete/unsupported_leap/fabrication describe what a learner
    // does, not recipes for building a wrong option. The asymmetry is the
    // design; asserting the reverse would force nonsense into CORRUPTIONS.
    const extras = ACCURACY_TYPES.filter((t) => !CORRUPTIONS.includes(t as never))
    expect(extras).toEqual([
      'omission', 'incomplete', 'unsupported_leap', 'fabrication',
    ])
  })
})

describe('vocabularies', () => {
  it('has no duplicate type across dimensions', () => {
    // A type appearing in two dimensions would make `validateTagType`
    // ambiguous and let the same string aggregate under two weights.
    const all = [...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES]
    expect(new Set(all).size).toBe(all.length)
  })

  it('weights every dimension, accuracy highest', () => {
    for (const d of DIMENSIONS) expect(DIM_WEIGHTS[d]).toBeGreaterThan(0)
    expect(DIM_WEIGHTS.accuracy).toBe(1.0)
    expect(DIM_WEIGHTS.clarity).toBe(0.8)
    expect(DIM_WEIGHTS.conciseness).toBe(0.7)
  })

  it('maps each dimension to its own vocabulary', () => {
    expect(typesForDimension('accuracy')).toEqual(ACCURACY_TYPES)
    expect(typesForDimension('clarity')).toEqual(CLARITY_TYPES)
    expect(typesForDimension('conciseness')).toEqual(CONCISENESS_TYPES)
  })
})

describe('validateTagType', () => {
  it('accepts a type belonging to its dimension', () => {
    expect(validateTagType('accuracy', 'inversion')).toBe(true)
    expect(validateTagType('conciseness', 'rambling')).toBe(true)
  })

  it('rejects a valid type paired with the WRONG dimension', () => {
    // The model can emit a real type under the wrong heading; that tag is
    // dropped rather than filed under a weight it was not judged against.
    expect(validateTagType('clarity', 'inversion')).toBe(false)
  })

  it('rejects a type in no vocabulary', () => {
    expect(validateTagType('accuracy', 'vibes')).toBe(false)
  })

  it('rejects an unknown dimension', () => {
    expect(validateTagType('delivery' as never, 'inversion')).toBe(false)
  })
})
