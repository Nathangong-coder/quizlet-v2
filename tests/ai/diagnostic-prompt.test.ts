import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTIC_GRADING_PROMPT,
  DIAGNOSTIC_QUESTIONS_PROMPT,
  DIAGNOSTIC_REPORT_PROMPT,
} from '@/lib/ai/prompts/diagnostic'
import { DiagnosticGradeSetSchema, DiagnosticQuestionSetSchema } from '@/lib/ai/schemas'

describe('DIAGNOSTIC_QUESTIONS_PROMPT v2', () => {
  it('is version 2', () => {
    expect(DIAGNOSTIC_QUESTIONS_PROMPT.version).toBe(2)
  })

  it('shows the key point and asks for one question per probe', () => {
    const prompt = DIAGNOSTIC_QUESTIONS_PROMPT.build({
      setTitle: 'M&A basics',
      probes: [{
        probeRef: 0,
        kind: 'core',
        term: 'Synergies',
        definition: 'Value created by combining companies.',
        keyPoint: 'Synergies are the value created by combining two companies that neither could create alone.',
      }],
    })

    expect(prompt).toContain('Synergies are the value created by combining two companies')
    expect(prompt).toContain('[0] (core)')
    expect(prompt).toContain('exactly one entry per probeRef')
  })

  it('tells the model not to widen past the key point it was given', () => {
    // The whole point of anchoring: a question that covers the rest of the card
    // would earn credit the selector never asked for.
    const prompt = DIAGNOSTIC_QUESTIONS_PROMPT.build({
      setTitle: 'x',
      probes: [{ probeRef: 0, kind: 'core', term: 't', definition: 'd', keyPoint: 'k' }],
    })
    expect(prompt).toContain('nothing else')
  })

  it('distinguishes a follow-up from a rephrase', () => {
    const prompt = DIAGNOSTIC_QUESTIONS_PROMPT.build({
      setTitle: 'x',
      probes: [{ probeRef: 0, kind: 'follow-up', term: 't', definition: 'd', keyPoint: 'k' }],
    })
    expect(prompt).toContain('Do not simply rephrase')
  })

  it('rejects a v1-shaped response instead of dropping its extra keys', () => {
    expect(DiagnosticQuestionSetSchema.safeParse({
      questions: [{ probeRef: 0, question: 'q', expectedAnswer: 'a' }],
    }).success).toBe(true)

    // cardRef/kind/learningPoint is the old contract — a question whose
    // learning point came from the model is exactly what v2 removes, so it
    // must fail loudly rather than parse with the extras stripped.
    expect(DiagnosticQuestionSetSchema.safeParse({
      questions: [{ cardRef: 0, kind: 'core', learningPoint: 'lp', question: 'q', expectedAnswer: 'a' }],
    }).success).toBe(false)
  })
})

describe('DIAGNOSTIC_GRADING_PROMPT v2', () => {
  it('is version 2', () => {
    expect(DIAGNOSTIC_GRADING_PROMPT.version).toBe(2)
  })

  it('keeps grading structured and shows the key point being judged', () => {
    const grading = DIAGNOSTIC_GRADING_PROMPT.build({
      questions: [{
        ref: 0,
        question: 'What are synergies?',
        expectedAnswer: 'Value created by combining companies.',
        keyPoint: 'Synergies are value neither company could create alone.',
        answer: 'Value from combining companies.',
      }],
    })

    expect(grading).toContain('Return exactly one grade per questionRef')
    expect(grading).toContain('Key point [0]: Synergies are value neither company could create alone.')
    expect(grading).toContain('exactly one entry, with klpRef 0')
  })

  it('forbids judging anything but the key point that was asked', () => {
    const grading = DIAGNOSTIC_GRADING_PROMPT.build({
      questions: [{ ref: 0, question: 'q', expectedAnswer: 'e', keyPoint: 'k', answer: 'a' }],
    })
    expect(grading).toContain('Judge ONLY that key point')
  })

  it('accepts per-key-point verdicts and error tags', () => {
    expect(DiagnosticGradeSetSchema.safeParse({
      grades: [{
        questionRef: 0, score: 6, status: 'partial', feedback: 'ok',
        klpResults: [{ klpRef: 0, status: 'partial', evidence: 'said half of it' }],
        errorTags: [{ dimension: 'accuracy', type: 'omission', klpRef: 0, magnitude: 5 }],
      }],
    }).success).toBe(true)
  })

  it('still parses a grade with no verdicts, so the caller can force no_provenance', () => {
    expect(DiagnosticGradeSetSchema.safeParse({
      grades: [{ questionRef: 0, score: 6, status: 'partial', feedback: 'ok' }],
    }).success).toBe(true)
  })

  it('never lets the model supply a number for a key point — only a category', () => {
    // Asking a model for a 0-1 score yields values bunched on round numbers:
    // precision that reads as real and is not. The float is computed in TS.
    expect(DiagnosticGradeSetSchema.safeParse({
      grades: [{
        questionRef: 0, score: 6, status: 'partial', feedback: 'ok',
        klpResults: [{ klpRef: 0, status: 0.5 }],
      }],
    }).success).toBe(false)
  })
})

describe('DIAGNOSTIC_REPORT_PROMPT v2', () => {
  it('is version 2 and still asks for an actionable plan', () => {
    const report = DIAGNOSTIC_REPORT_PROMPT.build({
      setTitle: 'M&A basics',
      results: [{
        question: 'What are synergies?',
        keyPoint: 'Synergies are value neither company could create alone.',
        answer: '',
        score: 4,
        status: 'missed',
        mistake: 'Missed the value-creation mechanism.',
      }],
    })

    expect(DIAGNOSTIC_REPORT_PROMPT.version).toBe(2)
    expect(report).toContain('immediate learning plan')
    expect(report).toContain('Recommendations must be actionable inside a study app')
    expect(report).toContain('Key point: Synergies are value neither company could create alone.')
  })
})
