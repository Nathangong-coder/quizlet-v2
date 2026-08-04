import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to submitShortAnswer only — quiz.ts is large and tangled; the other
// exports are out of scope for this file. Follows the pattern in
// tests/actions/quiz-options.test.ts and tests/actions/true-false.test.ts.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  generateJson: vi.fn(),
  ensureKlpsReady: vi.fn(),
  attemptFindFirst: vi.fn(),
  answerDeleteMany: vi.fn(),
  answerFindMany: vi.fn(),
  attemptUpdate: vi.fn(),
  cardFindUnique: vi.fn(),
  progressFindUnique: vi.fn(),
  transaction: vi.fn(),
  answerCreate: vi.fn(),
  klpResultCreateMany: vi.fn(),
  errorTagCreateMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst, update: h.attemptUpdate },
    quizAnswer: { deleteMany: h.answerDeleteMany, findMany: h.answerFindMany },
    card: { findUnique: h.cardFindUnique },
    cardProgress: { findUnique: h.progressFindUnique },
    // The transaction callback receives a tx object exposing just the three
    // models createAnswerWithAnalysis writes through.
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
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: vi.fn() }))

import { submitShortAnswer } from '@/actions/quiz'

const OWNER = 'user-owner'
const ATTEMPT_ID = 'a1'
const CARD_ID = 'c1'

const card = {
  id: CARD_ID,
  term: 'WACC',
  definition: 'Weighted Average Cost of Capital',
  setId: 'set1',
  // Empty content blocks -> `termBlocks.every(b => b.type === 'text')` is
  // vacuously true, so submitShortAnswer takes the text-only path.
  contentBlocks: [],
}

const klps = [{ id: 'klp-a', index: 0, text: 'x', weight: 5, kind: 'definition' }]

// A valid ShortAnswerGradeSchema object. Each test overrides only the fields
// (klpResults/errorTags) it exercises.
const gradeShape = {
  clarity: { score: 8, pros: ['clear'], cons: [] },
  conciseness: { score: 7, pros: [], cons: ['a bit long'] },
  correctness: { score: 9, pros: ['accurate'], cons: [] },
  overall: 8,
  summary: 'Good answer.',
  suggestedImprovement: 'Be more concise.',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.attemptFindFirst.mockResolvedValue({ sessionId: 'sess1' })
  h.answerDeleteMany.mockResolvedValue({ count: 0 })
  h.answerFindMany.mockResolvedValue([])
  h.attemptUpdate.mockResolvedValue({})
  h.cardFindUnique.mockResolvedValue(card)
  h.progressFindUnique.mockResolvedValue(null)
  h.ensureKlpsReady.mockResolvedValue(klps)
  h.generateJson.mockResolvedValue(gradeShape)
  h.answerCreate.mockResolvedValue({ id: 'answer-1' })
  h.klpResultCreateMany.mockResolvedValue({ count: 0 })
  h.errorTagCreateMany.mockResolvedValue({ count: 0 })
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      quizAnswer: { create: h.answerCreate },
      answerKlpResult: { createMany: h.klpResultCreateMany },
      answerErrorTag: { createMany: h.errorTagCreateMany },
    }),
  )
})

describe('submitShortAnswer analysis capture', () => {
  it('persists one KLP result per returned outcome, credited for the mode', async () => {
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'passed', evidence: 'said it' }],
      errorTags: [],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.klpResultCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ klpId: 'klp-a', status: 'passed', credit: 0.95, mode: 'quiz-sa' }),
    ])
  })

  it('computes relevance from the STORED KLP weight, not from the model', async () => {
    // The load-bearing test. The AI's only numeric input is severity (1-5);
    // if it could influence relevance it could inflate its own significance.
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [],
      errorTags: [{ dimension: 'accuracy', type: 'inversion', klpRef: 0, severity: 4, relevance: 99 }],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    const tag = h.errorTagCreateMany.mock.calls[0][0].data[0]
    expect(tag.relevance).toBe(5) // the KLP's stored weight
    expect(tag.severity).toBe(4)
    expect(tag.significance).toBe(9) // round((.55*5 + .45*4) * 2 * 1.0)
  })

  it('drops an unknown type, keeps the answer, and names the rejection', async () => {
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [],
      errorTags: [{ dimension: 'accuracy', type: 'vibes', klpRef: 0, severity: 3 }],
    })

    const res = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(res.success).toBe(true)
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()
    const data = h.answerCreate.mock.calls[0][0].data
    expect(data.analysisStatus).toBe('analyzed') // lossy, but still analyzed
    expect(data.analysisWarnings).toContainEqual({ reason: 'unknown_type', value: 'vibes' })
  })

  it('records no_klps for a card with no live KLPs', async () => {
    h.ensureKlpsReady.mockResolvedValue([])
    h.generateJson.mockResolvedValue({ ...gradeShape, klpResults: [], errorTags: [] })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('no_klps')
    expect(h.klpResultCreateMany).not.toHaveBeenCalled()
  })

  it('writes the answer and its analysis in one transaction', async () => {
    // A QuizAnswer without an analysisStatus is a row Spec 3 cannot classify,
    // and nothing later can distinguish it from an analysis that failed.
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'passed' }],
      errorTags: [],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.transaction).toHaveBeenCalledTimes(1)
  })
})
