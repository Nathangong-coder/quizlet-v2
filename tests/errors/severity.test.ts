import { describe, it, expect } from 'vitest'
import { CORRUPTIONS } from '@/lib/quiz/options'
import { CORRUPTION_SEVERITY } from '@/lib/errors/severity'

describe('CORRUPTION_SEVERITY', () => {
  it('ranks every corruption within 1-5', () => {
    for (const c of CORRUPTIONS) {
      expect(CORRUPTION_SEVERITY[c]).toBeGreaterThanOrEqual(1)
      expect(CORRUPTION_SEVERITY[c]).toBeLessThanOrEqual(5)
    }
  })

  it('ranks a wrong mental model above a retrieval slip', () => {
    // conflation/inversion mean the concept is misfiled or backwards;
    // factual_error is forgetting a number. Not the same problem.
    expect(CORRUPTION_SEVERITY.conflation).toBe(5)
    expect(CORRUPTION_SEVERITY.inversion).toBe(5)
    expect(CORRUPTION_SEVERITY.factual_error).toBe(2)
    expect(CORRUPTION_SEVERITY.conflation).toBeGreaterThan(CORRUPTION_SEVERITY.factual_error)
  })
})

// severityFromCorruption was deleted in Spec 3: resolveSeverity (bands.ts)
// supersedes it, and tests/errors/bands.test.ts pins the MC/TF no-op property
// (full magnitude reproduces CORRUPTION_SEVERITY exactly, with the same
// true/false one-point dock).
