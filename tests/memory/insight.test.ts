import { describe, it, expect } from 'vitest'
import { SessionInsightSchema, SessionInsightAiSchema } from '../../src/lib/memory/insight'
import { summarizeSession } from '../../src/lib/memory/summarize'

const computed = summarizeSession([])

describe('SessionInsightSchema', () => {
  it('accepts a computed-only insight (matching and review sessions)', () => {
    const parsed = SessionInsightSchema.parse({ version: 1, computed, ai: null })
    expect(parsed.ai).toBeNull()
  })

  it('rejects an unknown version so a stale blob cannot be misread', () => {
    expect(() => SessionInsightSchema.parse({ version: 2, computed, ai: null })).toThrow()
  })

  it('rejects a blob with no computed block', () => {
    expect(() => SessionInsightSchema.parse({ version: 1, ai: null })).toThrow()
  })
})

describe('SessionInsightAiSchema', () => {
  const focusArea = {
    title: 'DCF terminal value',
    severity: 'high' as const,
    evidence: 'Missed 3 of 3.',
    action: 'Re-read the 4 terminal-value cards, then focus-quiz them.',
    cardIds: ['c1'],
  }

  it('accepts a well-formed ranked list', () => {
    const parsed = SessionInsightAiSchema.parse({
      focusAreas: [focusArea],
      strengths: 'Accounting definitions were solid.',
    })
    expect(parsed.focusAreas).toHaveLength(1)
  })

  it('rejects an invented severity', () => {
    expect(() =>
      SessionInsightAiSchema.parse({
        focusAreas: [{ ...focusArea, severity: 'catastrophic' }],
        strengths: 'x',
      }),
    ).toThrow()
  })

  it('caps the list so one call cannot flood the summary', () => {
    expect(() =>
      SessionInsightAiSchema.parse({
        focusAreas: Array.from({ length: 6 }, () => focusArea),
        strengths: 'x',
      }),
    ).toThrow()
  })
})
