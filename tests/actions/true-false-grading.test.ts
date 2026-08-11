import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to submitTrueFalseAnswer only — quiz.ts is large and tangled; the
// other exports are out of scope for this file. Follows the pattern in
// tests/actions/true-false.test.ts and tests/actions/quiz-options.test.ts.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  // The advisory lock taken before any posterior read (B9).
  txQueryRaw: vi.fn(),
  generateJson: vi.fn(),
  recordStudyEvent: vi.fn(),
  ensureKlpsReady: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptUpdateMany: vi.fn(),
  questionFindUnique: vi.fn(),
  answerDeleteMany: vi.fn(),
  answerCreate: vi.fn(),
  answerFindMany: vi.fn(),
  answerFindFirst: vi.fn(),
  cardFindUnique: vi.fn(),
  progressFindUnique: vi.fn(),
  transaction: vi.fn(),
  klpResultCreateMany: vi.fn(),
  errorTagCreateMany: vi.fn(),
  klpStateFindUnique: vi.fn(),
  klpStateUpsert: vi.fn(),
  // B2: the belt-and-braces replacement delete moved inside the write
  // transaction, and now replays the posterior for any KLP its cascade
  // removed. Both reads default to empty — nothing here submits twice.
  txPriorFindMany: vi.fn(),
  txKlpResultFindMany: vi.fn(),
  klpStateDeleteMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst, updateMany: h.attemptUpdateMany },
    quizQuestion: { findUnique: h.questionFindUnique },
    quizAnswer: {
      deleteMany: h.answerDeleteMany,
      findMany: h.answerFindMany,
      findFirst: h.answerFindFirst,
    },
    card: { findUnique: h.cardFindUnique },
    cardProgress: { findUnique: h.progressFindUnique },
    // The transaction callback receives a tx object exposing just the three
    // models createAnswerWithAnalysis writes through (Task 10 wired
    // submitTrueFalseAnswer through the same helper submitShortAnswer uses).
    $transaction: h.transaction,
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
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: h.ensureKlpsReady }))
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
  h.answerFindFirst.mockResolvedValue(null)
  h.attemptUpdateMany.mockResolvedValue({})
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
  // Task 10: submitTrueFalseAnswer now derives analysis from KLPs/progress and
  // persists through createAnswerWithAnalysis's transaction. None of this
  // file's assertions are about analysis, so KLPs default empty (no rows) and
  // the transaction is a thin passthrough to the same answerCreate mock the
  // existing assertions read from.
  h.ensureKlpsReady.mockResolvedValue([])
  h.progressFindUnique.mockResolvedValue(null)
  h.klpResultCreateMany.mockResolvedValue({ count: 0 })
  h.errorTagCreateMany.mockResolvedValue({ count: 0 })
  h.klpStateFindUnique.mockResolvedValue(null)
  h.klpStateUpsert.mockResolvedValue({})
  h.txPriorFindMany.mockResolvedValue([])
  h.txKlpResultFindMany.mockResolvedValue([])
  h.klpStateDeleteMany.mockResolvedValue({ count: 0 })
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      quizAnswer: {
        create: h.answerCreate,
        findMany: h.txPriorFindMany,
        deleteMany: h.answerDeleteMany,
      },
      answerKlpResult: {
        createMany: h.klpResultCreateMany,
        findMany: h.txKlpResultFindMany,
      },
      // The advisory lock createAnswerWithAnalysis takes before touching any
      // posterior (B9). Registered here so the transaction still runs.
      $queryRaw: h.txQueryRaw,
      answerErrorTag: { createMany: h.errorTagCreateMany },
      klpState: {
        findUnique: h.klpStateFindUnique,
        upsert: h.klpStateUpsert,
        deleteMany: h.klpStateDeleteMany,
      },
      // Task 2's CardProgress replay is gated on a prior answer actually
      // being found (priorAnswerCount > 0). txPriorFindMany resolves []
      // above, so it never runs here — no studyEvent/cardProgress stub
      // needed on this fake tx.
    }),
  )
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

  it("rejects another user's attempt without touching any answer row", async () => {
    h.attemptFindFirst.mockResolvedValue(null)

    const result = await submitTrueFalseAnswer({
      attemptId: 'attempt-not-mine',
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Attempt not found')
    expect(h.answerDeleteMany).not.toHaveBeenCalled()
    expect(h.answerCreate).not.toHaveBeenCalled()
    expect(h.attemptUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects a second submission for the same card and leaves the stored answer alone', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'EBITDA includes interest expense.',
      isTrue: false,
    })
    h.answerFindFirst.mockResolvedValue({ id: 'existing-answer' })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'false',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('This question has already been answered.')
    expect(h.answerDeleteMany).not.toHaveBeenCalled()
    expect(h.answerCreate).not.toHaveBeenCalled()
    expect(h.attemptUpdateMany).not.toHaveBeenCalled()
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('scopes the score write to this user with updateMany', async () => {
    h.questionFindUnique.mockResolvedValue({ statement: 'x', isTrue: true })
    h.answerFindMany.mockResolvedValue([{ score: 100, mode: 'true-false', isCorrect: true }])

    await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(h.attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ATTEMPT_ID, userId: OWNER } }),
    )
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
      quizAnswerId: 'answer1',
      outcome: { correct: false },
      meta: { latencyMs: 1234 },
    })
  })
})
