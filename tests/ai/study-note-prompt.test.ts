import { describe, expect, it } from 'vitest'
import { STUDY_NOTE_ANALYSIS_PROMPT } from '@/lib/ai/prompts/study-note'

describe('study note analysis prompt', () => {
  it('keeps the learner note and line-oriented contract in the prompt', () => {
    const prompt = STUDY_NOTE_ANALYSIS_PROMPT.build({ title: 'DCF notes', body: 'Free cash flow drives valuation.\nRevisit terminal value.' })

    expect(prompt).toContain('DCF notes')
    expect(prompt).toContain('Free cash flow drives valuation.')
    expect(prompt).toContain('sourceLine as a zero-based line number')
    expect(STUDY_NOTE_ANALYSIS_PROMPT.version).toBe(1)
  })

  it('validates structured analysis output', () => {
    const parsed = STUDY_NOTE_ANALYSIS_PROMPT.schema.parse({
      summaryLines: [{ text: 'Free cash flow drives valuation.', sourceLine: 0, kind: 'insight' }],
      keyTerms: ['free cash flow'],
      followUps: ['Review terminal value assumptions.'],
    })

    expect(parsed.summaryLines[0]).toMatchObject({ text: 'Free cash flow drives valuation.', kind: 'insight' })
  })

  it('accepts review-only removal suggestions without changing the source contract', () => {
    const parsed = STUDY_NOTE_ANALYSIS_PROMPT.schema.parse({
      summaryLines: [{ text: 'Terminal value needs an explicit assumption.', sourceLine: 1, kind: 'action' }],
      keyTerms: ['terminal value'],
      followUps: ['Stress-test the exit multiple.'],
      suggestions: [{ sourceLine: 1, kind: 'remove', excerpt: 'Revisit terminal value.', rationale: 'This repeats the more specific line above.' }],
    })

    expect(parsed.suggestions[0]).toMatchObject({ sourceLine: 1, kind: 'remove' })
  })
})
