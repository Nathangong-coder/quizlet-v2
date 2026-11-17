import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spec 6 §3.1: every quiz submit action forwards the learner's self-rating
// into `recordStudyEvent`'s meta with the retrospective moment. One assertion
// per call site — MC, TF, SA text path, SA multimodal path — plus the TF
// null-outcome guard. The gate itself (toggle, vocabulary) is
// recordStudyEvent's and is tested in tests/memory/record-self-rating.test.ts;
// here it is mocked, so these tests only prove the plumbing.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  txExecuteRaw: vi.fn(),
  generateJson: vi.fn(),
  recordStudyEvent: vi.fn(),
  ensureKlpsReady: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptUpdate: vi.fn(),
  attemptUpdateMany: vi.fn(),
  answerDeleteMany: vi.fn(),
  answerFindMany: vi.fn(),
  answerFindFirst: vi.fn(),
  cardFindUnique: vi.fn(),
  questionFindUnique: vi.fn(),
  progressFindUnique: vi.fn(),
  transaction: vi.fn(),
  answerCreate: vi.fn(),
  klpResultCreateMany: vi.fn(),
  errorTagCreateMany: vi.fn(),
  klpStateFindUnique: vi.fn(),
  klpStateUpsert: vi.fn(),
  txPriorFindMany: vi.fn(),
  txKlpResultFindMany: vi.fn(),
  klpStateDeleteMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: {
      findFirst: h.attemptFindFirst,
      update: h.attemptUpdate,
      updateMany: h.attemptUpdateMany,
    },
    quizQuestion: { findUnique: h.questionFindUnique },
    quizAnswer: {
      deleteMany: h.answerDeleteMany,
      findMany: h.answerFindMany,
      findFirst: h.answerFindFirst,
    },
    card: { findUnique: h.cardFindUnique },
    cardProgress: { findUnique: h.progressFindUnique },
    $transaction: h.transaction,
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  generateJsonWithMeta: async (...args: unknown[]) => ({
    value: await h.generateJson(...args),
    meta: { model: 'test-model', provider: 'google', credentialId: 'cred-1' },
  }),
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

import { submitMultipleChoiceAnswer, submitTrueFalseAnswer, submitShortAnswer } from '@/actions/quiz'

const OWNER = 'user-owner'
const ATTEMPT_ID = 'attempt1'
const CARD_ID = 'card1'
const SESSION_ID = 'session1'

const textCard = {
  id: CARD_ID,
  term: 'WACC',
  definition: 'Weighted Average Cost of Capital',
  setId: 'set1',
  klpVersion: 1,
  contentBlocks: [],
}

const gradeShape = {
  clarity: { score: 8, pros: ['clear'], cons: [] },
  conciseness: { score: 7, pros: [], cons: ['a bit long'] },
  correctness: { score: 9, pros: ['accurate'], cons: [] },
  overall: 8,
  summary: 'Good answer.',
  suggestedImprovement: 'Be more concise.',
}

function lastMeta() {
  return h.recordStudyEvent.mock.calls.at(-1)![0].meta
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.attemptFindFirst.mockResolvedValue({ sessionId: SESSION_ID })
  h.answerDeleteMany.mockResolvedValue({ count: 0 })
  h.answerFindMany.mockResolvedValue([])
  h.answerFindFirst.mockResolvedValue(null)
  h.attemptUpdate.mockResolvedValue({})
  h.attemptUpdateMany.mockResolvedValue({})
  h.cardFindUnique.mockResolvedValue(textCard)
  h.progressFindUnique.mockResolvedValue(null)
  h.ensureKlpsReady.mockResolvedValue([])
  h.generateJson.mockResolvedValue(gradeShape)
  h.answerCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'answer-1', ...data }))
  h.klpResultCreateMany.mockResolvedValue({ count: 0 })
  h.errorTagCreateMany.mockResolvedValue({ count: 0 })
  h.klpStateFindUnique.mockResolvedValue(null)
  h.klpStateUpsert.mockResolvedValue({})
  h.txPriorFindMany.mockResolvedValue([])
  h.txKlpResultFindMany.mockResolvedValue([])
  h.klpStateDeleteMany.mockResolvedValue({ count: 0 })
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
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
      $executeRaw: h.txExecuteRaw,
      answerErrorTag: { createMany: h.errorTagCreateMany },
      klpState: {
        findUnique: h.klpStateFindUnique,
        upsert: h.klpStateUpsert,
        deleteMany: h.klpStateDeleteMany,
      },
    }),
  )
})

describe('quiz submit actions forward the self-rating (Spec 6 §3.1)', () => {
  it('submitMultipleChoiceAnswer forwards selfRating with moment after_answer', async () => {
    h.questionFindUnique.mockResolvedValue(null)
    const res = await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'A',
      correctAnswer: 'A',
      latencyMs: 500,
      selfRating: 3,
    })
    expect(res.success).toBe(true)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(1)
    expect(lastMeta()).toEqual({ latencyMs: 500, selfRating: 3, selfRatingMoment: 'after_answer' })
  })

  it('submitMultipleChoiceAnswer without a rating still names the moment and leaves the rating undefined', async () => {
    h.questionFindUnique.mockResolvedValue(null)
    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'A',
      correctAnswer: 'B',
    })
    expect(lastMeta().selfRating).toBeUndefined()
    expect(lastMeta().selfRatingMoment).toBe('after_answer')
  })

  it('submitTrueFalseAnswer forwards selfRating with moment after_answer', async () => {
    h.questionFindUnique.mockResolvedValue({ statement: 'WACC is a discount rate.', isTrue: true })
    const res = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
      latencyMs: 800,
      selfRating: 4,
    })
    expect(res.success).toBe(true)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(1)
    expect(lastMeta()).toEqual({ latencyMs: 800, selfRating: 4, selfRatingMoment: 'after_answer' })
  })

  it('a TF answer with isCorrect === null never reaches recordStudyEvent, rating or not', async () => {
    h.questionFindUnique.mockResolvedValue(null)
    const res = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
      selfRating: 4,
    })
    expect(res.success).toBe(true)
    if (!res.success) throw new Error(res.error)
    expect(res.data.isCorrect).toBeNull()
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('submitShortAnswer (text path) forwards selfRating with moment after_answer', async () => {
    const res = await submitShortAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      answer: 'The blended cost of debt and equity.',
      latencyMs: 12000,
      selfRating: 2,
    })
    expect(res.success).toBe(true)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(1)
    expect(lastMeta()).toEqual({ latencyMs: 12000, selfRating: 2, selfRatingMoment: 'after_answer' })
  })

  it('submitShortAnswer (multimodal path) forwards selfRating with moment after_answer', async () => {
    h.cardFindUnique.mockResolvedValue({
      ...textCard,
      contentBlocks: [{ type: 'image', text: null, position: 0 }],
    })
    const res = await submitShortAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      answer: 'The blended cost of debt and equity.',
      latencyMs: 9000,
      selfRating: 1,
    })
    expect(res.success).toBe(true)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(1)
    expect(lastMeta()).toEqual({ latencyMs: 9000, selfRating: 1, selfRatingMoment: 'after_answer' })
  })

  it('the action never validates the rating itself — the gate is recordStudyEvent', async () => {
    // A malformed value is forwarded untouched; recordStudyEvent drops it.
    // Validating here too would mean two gates that could disagree.
    h.questionFindUnique.mockResolvedValue(null)
    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'A',
      correctAnswer: 'A',
      selfRating: 9,
    })
    expect(lastMeta().selfRating).toBe(9)
  })
})
