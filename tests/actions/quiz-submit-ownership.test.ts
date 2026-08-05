import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Scoped to the owner guard on the submit actions. All three fetched the
 * attempt with an owner-scoped `findFirst` but never checked the result, so a
 * foreign attemptId still reached the delete/insert/score writes below it.
 * Follows the mocking pattern in tests/actions/true-false-grading.test.ts.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  generateJson: vi.fn(),
  recordStudyEvent: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptUpdate: vi.fn(),
  attemptUpdateMany: vi.fn(),
  answerDeleteMany: vi.fn(),
  answerCreate: vi.fn(),
  answerFindMany: vi.fn(),
  answerFindFirst: vi.fn(),
  cardFindUnique: vi.fn(),
  optionCacheFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: {
      findFirst: h.attemptFindFirst,
      update: h.attemptUpdate,
      updateMany: h.attemptUpdateMany,
    },
    quizQuestion: { findUnique: vi.fn() },
    quizAnswer: {
      deleteMany: h.answerDeleteMany,
      create: h.answerCreate,
      findMany: h.answerFindMany,
      findFirst: h.answerFindFirst,
    },
    quizOptionCache: { findMany: h.optionCacheFindMany },
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

import {
  submitMultipleChoiceAnswer,
  submitShortAnswer,
  submitTrueFalseAnswer,
  getQuizAttemptSummary,
} from '@/actions/quiz'

const OWNER = 'user-owner'
const FOREIGN_ATTEMPT = 'attempt-belonging-to-someone-else'
const CARD_ID = 'card1'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  // Owner-scoped findFirst finds nothing: the attempt is not this user's.
  h.attemptFindFirst.mockResolvedValue(null)
  h.answerFindFirst.mockResolvedValue(null)
  h.answerFindMany.mockResolvedValue([])
  h.cardFindUnique.mockResolvedValue({
    id: CARD_ID,
    term: 'EBITDA',
    definition: 'Earnings before interest, taxes, depreciation, and amortization.',
    setId: 'set1',
    contentBlocks: [],
  })
})

function expectNoWrites() {
  expect(h.answerDeleteMany).not.toHaveBeenCalled()
  expect(h.answerCreate).not.toHaveBeenCalled()
  expect(h.attemptUpdate).not.toHaveBeenCalled()
  expect(h.attemptUpdateMany).not.toHaveBeenCalled()
  expect(h.recordStudyEvent).not.toHaveBeenCalled()
}

describe('submit actions reject a foreign attemptId', () => {
  it('submitMultipleChoiceAnswer', async () => {
    const result = await submitMultipleChoiceAnswer({
      attemptId: FOREIGN_ATTEMPT,
      cardId: CARD_ID,
      selectedOption: 'a',
      correctAnswer: 'a',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Attempt not found')
    expect(h.attemptFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FOREIGN_ATTEMPT, userId: OWNER } }),
    )
    expectNoWrites()
  })

  it('submitTrueFalseAnswer', async () => {
    const result = await submitTrueFalseAnswer({
      attemptId: FOREIGN_ATTEMPT,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Attempt not found')
    expectNoWrites()
  })

  it('submitShortAnswer', async () => {
    const result = await submitShortAnswer({
      attemptId: FOREIGN_ATTEMPT,
      cardId: CARD_ID,
      answer: 'some answer',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Attempt not found')
    expect(h.generateJson).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('getQuizAttemptSummary', async () => {
    // No owner check at all previously — findUnique({ where: { id } }) let
    // any authenticated user view any other user's quiz results, including
    // (as of Spec 2b) verbatim quotes from their short answers via
    // AnswerKlpResult.evidence / AnswerErrorTag.quote.
    const result = await getQuizAttemptSummary(FOREIGN_ATTEMPT)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Attempt not found')
    expect(h.attemptFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FOREIGN_ATTEMPT, userId: OWNER } }),
    )
  })
})
