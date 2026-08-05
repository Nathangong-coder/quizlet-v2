import { describe, it, expect } from 'vitest'
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES } from '@/lib/errors/taxonomy'
import { KLP_STATUSES } from '@/lib/errors/klp-credit'
import { labelForErrorType, labelForKlpStatus } from '@/lib/errors/labels'

describe('labelForErrorType', () => {
  it('has a label for every type in every dimension', () => {
    for (const t of [...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES]) {
      const label = labelForErrorType(t)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toContain('_') // humanized, not the raw snake_case
    }
  })

  it('falls back to a de-slugged version of an unrecognized type rather than throwing', () => {
    // Defence in depth: the vocabulary can grow; a missing label entry should
    // degrade gracefully, not crash the results page.
    expect(() => labelForErrorType('some_new_type')).not.toThrow()
    expect(labelForErrorType('some_new_type')).not.toContain('_')
  })

  it('capitalizes only the first word when de-slugging', () => {
    expect(labelForErrorType('some_new_type')).toBe('Some new type')
  })

  it('never returns the literal string "undefined" for a degenerate input', () => {
    // Regression: `w[0]?.toUpperCase() + w.slice(1)` on an empty first word
    // silently produces the STRING "undefined" via concatenation, not a
    // thrown error and not an empty string — the worst of both worlds for a
    // function whose entire point is graceful degradation.
    expect(labelForErrorType('')).not.toContain('undefined')
    expect(labelForErrorType('_leading_underscore')).not.toContain('undefined')
  })
})

describe('labelForKlpStatus', () => {
  it('has a label for every status', () => {
    for (const s of KLP_STATUSES) {
      expect(labelForKlpStatus(s).length).toBeGreaterThan(0)
    }
  })
})
