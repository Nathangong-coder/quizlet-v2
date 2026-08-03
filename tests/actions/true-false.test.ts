import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to getTrueFalseQuestion only — quiz.ts is large and tangled; the
// other exports are out of scope for this file. Follows the pattern in
// tests/actions/quiz-options.test.ts.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  generateJson: vi.fn(),
  ensureKlpsReady: vi.fn(),
  attemptFindFirst: vi.fn(),
  questionFindUnique: vi.fn(),
  questionUpsert: vi.fn(),
  cardFindFirst: vi.fn(),
  pickTfVariant: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst },
    quizQuestion: { findUnique: h.questionFindUnique, upsert: h.questionUpsert },
    card: { findFirst: h.cardFindFirst },
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
vi.mock('@/lib/quiz/coin-flip', () => ({ pickTfVariant: h.pickTfVariant }))

import { getTrueFalseQuestion } from '@/actions/quiz'

const OWNER = 'user-owner'
const ATTEMPT_ID = 'attempt1'
const CARD_ID = 'card1'
const DEFINITION = 'Earnings before interest, taxes, depreciation, and amortization.'

const card = {
  id: CARD_ID,
  term: 'EBITDA',
  definition: DEFINITION,
  setId: 'set1',
  klpVersion: 4,
}

const klps = [
  { id: 'klp-real-0', index: 0, text: 'EBITDA excludes interest expense', weight: 5, kind: 'definition' },
  { id: 'klp-real-1', index: 1, text: 'D&A is added back because non-cash', weight: 3, kind: 'mechanism' },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.attemptFindFirst.mockResolvedValue({ id: ATTEMPT_ID, selectedCardIds: [CARD_ID] })
  h.questionFindUnique.mockResolvedValue(null)
  h.questionUpsert.mockResolvedValue({})
  h.cardFindFirst.mockResolvedValue(card)
  h.ensureKlpsReady.mockResolvedValue(klps)
  h.pickTfVariant.mockReturnValue('true')
})

describe('getTrueFalseQuestion', () => {
  it('never returns the answer key: data has exactly the statement key', async () => {
    h.pickTfVariant.mockReturnValue('false')
    h.generateJson.mockResolvedValue({
      statement: 'EBITDA includes interest expense.',
      klpRef: 0,
      corruption: 'inversion',
    })

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(Object.keys(result.data)).toEqual(['statement'])
    expect(result.data.statement).toBe('EBITDA includes interest expense.')
    // isTrue must never appear anywhere on the returned object.
    expect((result.data as any).isTrue).toBeUndefined()
  })

  it('a repeat request returns the stored statement without regenerating', async () => {
    h.questionFindUnique.mockResolvedValue({ statement: 'Stored statement from first request.' })

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.statement).toBe('Stored statement from first request.')
    expect(h.generateJson).not.toHaveBeenCalled()
    expect(h.pickTfVariant).not.toHaveBeenCalled()
    expect(h.questionUpsert).not.toHaveBeenCalled()
  })

  it('the false variant persists coherent provenance', async () => {
    h.pickTfVariant.mockReturnValue('false')
    h.generateJson.mockResolvedValue({
      statement: 'D&A is subtracted because it is a cash expense.',
      klpRef: 1,
      corruption: 'inversion',
    })

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(true)
    expect(h.questionUpsert).toHaveBeenCalledTimes(1)
    const payload = h.questionUpsert.mock.calls[0][0]
    expect(payload.create.isTrue).toBe(false)
    expect(payload.create.statement).toBe('D&A is subtracted because it is a cash expense.')
    expect(payload.create.targetKlpIds).toEqual(['klp-real-1'])
    // The corruption is persisted in its own column; without it a wrong TF
    // answer records only WHICH proposition was targeted, not HOW.
    expect(payload.create.corruption).toBe('inversion')
    expect(payload.update).toEqual({
      statement: payload.create.statement,
      isTrue: payload.create.isTrue,
      corruption: payload.create.corruption,
      targetKlpIds: payload.create.targetKlpIds,
      klpVersion: payload.create.klpVersion,
    })
  })

  it('the true variant persists a null corruption', async () => {
    h.pickTfVariant.mockReturnValue('true')

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(true)
    const payload = h.questionUpsert.mock.calls[0][0]
    expect(payload.create.isTrue).toBe(true)
    expect(payload.create.corruption).toBeNull()
  })

  it('a generation failure persists a null corruption, not a stale one', async () => {
    h.pickTfVariant.mockReturnValue('false')
    h.generateJson.mockRejectedValue(new Error('provider down'))

    await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    const payload = h.questionUpsert.mock.calls[0][0]
    expect(payload.create.isTrue).toBe(true)
    expect(payload.create.corruption).toBeNull()
  })

  it('an out-of-range klpRef falls back to the true variant coherently', async () => {
    h.pickTfVariant.mockReturnValue('false')
    h.generateJson.mockResolvedValue({
      statement: 'Some corrupted statement.',
      klpRef: 7,
      corruption: 'inversion',
    })

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.statement).toBe(DEFINITION)

    const payload = h.questionUpsert.mock.calls[0][0]
    expect(payload.create.isTrue).toBe(true)
    expect(payload.create.statement).toBe(DEFINITION)
    expect(payload.create.targetKlpIds).toEqual(['klp-real-0', 'klp-real-1'])
  })

  it('a generation failure still writes an answerable row', async () => {
    h.pickTfVariant.mockReturnValue('false')
    h.generateJson.mockRejectedValue(new Error('provider down'))

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.statement).toBe(DEFINITION)

    expect(h.questionUpsert).toHaveBeenCalledTimes(1)
    const payload = h.questionUpsert.mock.calls[0][0]
    expect(payload.create.isTrue).toBe(true)
    expect(payload.create.statement).toBe(DEFINITION)
  })

  it("rejects a card the user does not own and triggers no KLP extraction", async () => {
    h.cardFindFirst.mockResolvedValue(null)

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Card not found')
    expect(h.cardFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CARD_ID, set: { userId: OWNER } } }),
    )
    expect(h.ensureKlpsReady).not.toHaveBeenCalled()
    expect(h.questionUpsert).not.toHaveBeenCalled()
  })

  it('rejects a card that is not part of this attempt', async () => {
    h.attemptFindFirst.mockResolvedValue({ id: ATTEMPT_ID, selectedCardIds: ['some-other-card'] })

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Card not found')
    expect(h.cardFindFirst).not.toHaveBeenCalled()
    expect(h.ensureKlpsReady).not.toHaveBeenCalled()
    expect(h.questionUpsert).not.toHaveBeenCalled()
  })

  it("rejects another user's attempt and writes no question row", async () => {
    h.attemptFindFirst.mockResolvedValue(null)

    const result = await getTrueFalseQuestion(ATTEMPT_ID, CARD_ID)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Attempt not found')
    expect(h.questionUpsert).not.toHaveBeenCalled()
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})
