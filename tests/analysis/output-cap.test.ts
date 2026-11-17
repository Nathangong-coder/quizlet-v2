import { describe, it, expect } from 'vitest'
import { gradeMaxOutputTokens, GRADE_TOKENS_BASE, GRADE_TOKENS_PER_ITEM } from '@/lib/analysis/output-cap'

describe('gradeMaxOutputTokens', () => {
  it('scales with item count and never drops below the base', () => {
    expect(gradeMaxOutputTokens(0)).toBe(GRADE_TOKENS_BASE)
    expect(gradeMaxOutputTokens(9) - gradeMaxOutputTokens(4)).toBe(5 * GRADE_TOKENS_PER_ITEM)
  })

  it('is linear: base plus itemCount times the per-item slope', () => {
    expect(gradeMaxOutputTokens(6)).toBe(GRADE_TOKENS_BASE + 6 * GRADE_TOKENS_PER_ITEM)
  })

  it('ships the provisional constants until the probe sets real ones', () => {
    // Pinned so a drive-by edit to these numbers is a deliberate, reviewed
    // change, not an accidental one — they are provisional (2048/600) until
    // `scripts/probe-grade-tokens.ts` is run against a real model and prints
    // the measured pair.
    expect(GRADE_TOKENS_BASE).toBe(2048)
    expect(GRADE_TOKENS_PER_ITEM).toBe(600)
  })
})
