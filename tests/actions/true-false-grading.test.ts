import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to submitTrueFalseAnswer only — quiz.ts is large and tangled; the
// other exports are out of scope for this file. Follows the pattern in
// tests/actions/true-false.test.ts and tests/actions/quiz-options.test.ts.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  generateJson: vi.fn(),
  recordStudyEvent: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptUpdate: vi.fn(),
  questionFindUnique: vi.fn(),
  answerDeleteMany: vi.fn(),
  answerCreate: vi.fn(),
  answerFindMany: vi.fn(),
  cardFindUnique: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst, update: h.attemptUpdate },
    quizQuestion: { findUnique: h.questionFindUnique },
    quizAnswer: { deleteMany: h.answerDeleteMany, create: h.answerCreate, findMany: h.answerFindMany },
    card: { findUnique: h.cardFindUnique },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  resolveTaskModel: vi.fn(),
  AiGenerationError: class extends Error {
    constructor(public detail: { title: string; attempts: unknown[] }) {
      super('ai generation failed')
    }
  },
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: vi.fn() }))
vi.mock('@/lib/quiz/coin-flip', () => ({ pickTfVariant: vi.fn() }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))

import { submitTrueFalseAnswer } from '@/actions/quiz'

const OWNER = 'user-owner'
const ATTEMPT_ID = 'attempt1'
const CARD_ID = 'card1'
const SESSION_ID = 'session1'

const card = {
  id: CARD_ID,
  term: 'EBITDA',
  definition: 'Earnings before interest, taxes, depreciation, and amortization.',
  setId: 'set1',
  klpVersion: 4,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.attemptFindFirst.mockResolvedValue({ sessionId: SESSION_ID })
  h.answerDeleteMany.mockResolvedValue({})
  h.cardFindUnique.mockResolvedValue(card)
  // AI feedback generation fails by default in these tests — irrelevant to
  // grading correctness and exercised elsewhere (MC feedback precedent).
  h.generateJson.mockRejectedValue(new Error('no credentials'))
  h.answerCreate.mockImplementation(async ({ data }: any) => ({ id: 'answer1', ...data }))
  h.answerFindMany.mockResolvedValue([])
  h.attemptUpdate.mockResolvedValue({})
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
})

describe('submitTrueFalseAnswer', () => {
  it('answering "true" to a stored corrupted statement (isTrue: false) is incorrect', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'EBITDA includes interest expense.',
      isTrue: false,
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(false)
    expect(result.data.score).toBe(0)

    expect(h.answerCreate).toHaveBeenCalledTimes(1)
    const payload = h.answerCreate.mock.calls[0][0].data
    expect(payload.isCorrect).toBe(false)
    expect(payload.score).toBe(0)
    expect(payload.correctAnswer).toBe('false')
  })

  it('answering "false" to a stored corrupted statement is correct', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'EBITDA includes interest expense.',
      isTrue: false,
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'false',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(true)
    expect(result.data.score).toBe(100)

    const payload = h.answerCreate.mock.calls[0][0].data
    expect(payload.isCorrect).toBe(true)
    expect(payload.score).toBe(100)
    expect(payload.correctAnswer).toBe('false')
  })

  it('answering "true" to a stored real definition (isTrue: true) is correct', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'EBITDA excludes interest, taxes, depreciation, and amortization.',
      isTrue: true,
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(true)
    expect(result.data.score).toBe(100)

    const payload = h.answerCreate.mock.calls[0][0].data
    expect(payload.isCorrect).toBe(true)
    expect(payload.score).toBe(100)
    expect(payload.correctAnswer).toBe('true')
  })

  it('answering "false" to a stored real definition is incorrect', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'EBITDA excludes interest, taxes, depreciation, and amortization.',
      isTrue: true,
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'false',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(false)
    expect(result.data.score).toBe(0)

    const payload = h.answerCreate.mock.calls[0][0].data
    expect(payload.isCorrect).toBe(false)
    expect(payload.score).toBe(0)
    expect(payload.correctAnswer).toBe('true')
  })

  it('with no QuizQuestion row, the answer is persisted unscored and memory is not written', async () => {
    h.questionFindUnique.mockResolvedValue(null)

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBeNull()
    expect(result.data.score).toBeNull()

    expect(h.answerCreate).toHaveBeenCalledTimes(1)
    const payload = h.answerCreate.mock.calls[0][0].data
    expect(payload.isCorrect).toBeNull()
    expect(payload.score).toBeNull()
    // Legacy/unscored default: no key exists, so the stored "correct answer"
    // defaults to 'true' rather than fabricating a false key.
    expect(payload.correctAnswer).toBe('true')

    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('with a question row present, recordStudyEvent is called with the correct outcome', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'EBITDA includes interest expense.',
      isTrue: false,
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
      latencyMs: 1234,
    })

    expect(result.success).toBe(true)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(1)
    expect(h.recordStudyEvent).toHaveBeenCalledWith({
      userId: OWNER,
      cardId: CARD_ID,
      source: 'quiz-tf',
      sessionId: SESSION_ID,
      outcome: { correct: false },
      meta: { latencyMs: 1234 },
    })
  })
})
