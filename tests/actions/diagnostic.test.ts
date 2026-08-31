import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class MockAiGenerationError extends Error {
    detail: { title: string; why: string }

    constructor(detail: { title: string; why: string }) {
      super(detail.title)
      this.name = 'AiGenerationError'
      this.detail = detail
    }
  }

  return {
    auth: vi.fn(),
    setFindMany: vi.fn(),
    setFindFirst: vi.fn(),
    diagnosticFindFirst: vi.fn(),
    generateJson: vi.fn(),
    transaction: vi.fn(),
    recordStudyEvent: vi.fn(),
    AiGenerationError: MockAiGenerationError,
  }
})

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    set: { findMany: h.setFindMany, findFirst: h.setFindFirst },
    diagnosticAttempt: { findFirst: h.diagnosticFindFirst },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/ai/generate', () => ({ generateJson: h.generateJson, AiGenerationError: h.AiGenerationError }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { startDiagnosticTest, submitDiagnosticTest } from '@/actions/diagnostic'

const OWNER = 'user-owner'
const cards = [
  { id: 'card-1', term: 'Synergies', definition: 'Value created by combining companies.' },
  { id: 'card-2', term: 'Accretion', definition: 'An increase in earnings per share after a deal.' },
]
const generatedQuestions = Array.from({ length: 12 }, (_, position) => ({
  cardRef: position % 2,
  kind: position % 3 === 0 ? 'follow-up' : 'core',
  learningPoint: `Point ${position + 1}`,
  question: `Question ${position + 1}?`,
  expectedAnswer: `Answer ${position + 1}`,
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
})

describe('diagnostic actions', () => {
  it('uses the selected readable set and persists generated questions', async () => {
    h.setFindFirst.mockResolvedValue({ id: 'set-1', title: 'M&A basics', cards })
    h.generateJson.mockResolvedValue({ questions: generatedQuestions })
    h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      studySession: { create: vi.fn().mockResolvedValue({ id: 'session-1' }) },
      diagnosticAttempt: {
        create: vi.fn().mockResolvedValue({
          id: 'attempt-1',
          questions: generatedQuestions.map((_, position) => ({ id: `question-${position}` })),
        }),
      },
    }))

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.attemptId).toBe('attempt-1')
      expect(result.data.questions).toHaveLength(12)
    }
    expect(h.setFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'set-1' }) }))
    expect(h.generateJson).toHaveBeenCalledWith(expect.objectContaining({ task: 'diagnostic' }))
  })

  it('surfaces the existing structured no-credential error', async () => {
    h.setFindFirst.mockResolvedValue({ id: 'set-1', title: 'M&A basics', cards })
    h.generateJson.mockRejectedValue(new h.AiGenerationError({ title: 'No AI provider configured', why: 'Add a credential in AI settings.' }))

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result).toEqual({
      success: false,
      error: 'No AI provider configured',
      detail: { title: 'No AI provider configured', why: 'Add a credential in AI settings.' },
    })
  })

  it('grades every question, records diagnostic memory, and returns recommendations', async () => {
    const attemptQuestions = generatedQuestions.map((question, position) => ({
      id: `question-${position}`,
      position,
      kind: question.kind,
      learningPoint: question.learningPoint,
      prompt: question.question,
      expectedAnswer: question.expectedAnswer,
      cardId: cards[position % 2].id,
    }))
    h.diagnosticFindFirst.mockResolvedValue({
      id: 'attempt-1',
      userId: OWNER,
      sessionId: 'session-1',
      status: 'in_progress',
      set: { title: 'M&A basics' },
      session: { startedAt: new Date(Date.now() - 1000) },
      questions: attemptQuestions,
    })
    h.generateJson
      .mockResolvedValueOnce({ grades: generatedQuestions.map((_, position) => ({ questionRef: position, score: position === 0 ? 4 : 9, status: position === 0 ? 'missed' : 'mastered', feedback: `Feedback ${position + 1}`, mistake: position === 0 ? 'Missed the mechanism.' : undefined })) })
      .mockResolvedValueOnce({ overview: 'One gap surfaced.', strengths: ['Most points'], gaps: ['Point 1'], recommendations: ['Review Point 1.'], learningPoints: [{ text: 'Point 1', score: 4, evidence: 'The answer missed the mechanism.', nextAction: 'Retry a follow-up.' }] })
    h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      diagnosticQuestion: { update: vi.fn().mockResolvedValue({}) },
      diagnosticAttempt: { update: vi.fn().mockResolvedValue({}) },
      studySession: { update: vi.fn().mockResolvedValue({}) },
    }))

    const result = await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions.map((question) => ({ questionId: question.id, answer: `Answer for ${question.id}` })),
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.score).toBe(86)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(12)
    expect(h.recordStudyEvent).toHaveBeenCalledWith(expect.objectContaining({ source: 'diagnostic', sessionId: 'session-1' }), expect.anything())
  })
})
