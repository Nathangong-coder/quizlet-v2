import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTIC_GRADING_PROMPT,
  DIAGNOSTIC_QUESTIONS_PROMPT,
  DIAGNOSTIC_REPORT_PROMPT,
} from '@/lib/ai/prompts/diagnostic'

describe('diagnostic prompts', () => {
  it('asks for broad card coverage and follow-ups', () => {
    const prompt = DIAGNOSTIC_QUESTIONS_PROMPT.build({
      setTitle: 'M&A basics',
      questionCount: 12,
      cards: [{ ref: 0, term: 'Synergies', definition: 'Value created by combining companies.' }],
    })

    expect(prompt).toContain('exactly 12 open-ended questions')
    expect(prompt).toContain('at least two follow-up questions')
    expect(prompt).toContain('[0] Term: Synergies')
    expect(DIAGNOSTIC_QUESTIONS_PROMPT.version).toBe(1)
  })

  it('keeps grading and recommendation generation structured', () => {
    const grading = DIAGNOSTIC_GRADING_PROMPT.build({
      questions: [{ ref: 0, question: 'What are synergies?', expectedAnswer: 'Value created by combining companies.', learningPoint: 'Synergies', answer: 'Value from combining companies.' }],
    })
    const report = DIAGNOSTIC_REPORT_PROMPT.build({
      setTitle: 'M&A basics',
      results: [{ question: 'What are synergies?', learningPoint: 'Synergies', answer: '', score: 4, status: 'missed', mistake: 'Missed the value-creation mechanism.' }],
    })

    expect(grading).toContain('Return exactly one grade per questionRef')
    expect(report).toContain('immediate learning plan')
    expect(report).toContain('Recommendations must be actionable inside a study app')
  })
})
