import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to getOrGenerateMultipleChoiceOptions only — quiz.ts is large and
// tangled; the other exports are out of scope for this file.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  generateJson: vi.fn(),
  resolveTaskModel: vi.fn(),
  ensureKlpsReady: vi.fn(),
  safeProfileBlock: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  cardFindUnique: vi.fn(),
  cardFindFirst: vi.fn(),
  setFindUnique: vi.fn(),
  attemptFindFirst: vi.fn(),
  questionUpsert: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizOptionCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
    // `findFirst` is the owner-scoped main card lookup; `findUnique` backs
    // recordQuizQuestion's klpVersion read.
    card: { findUnique: h.cardFindUnique, findFirst: h.cardFindFirst },
    set: { findUnique: h.setFindUnique },
    // recordQuizQuestion's owner check on attemptId, added alongside the
    // cardId owner check this file already covered.
    quizAttempt: { findFirst: h.attemptFindFirst },
    quizQuestion: { upsert: h.questionUpsert },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  resolveTaskModel: h.resolveTaskModel,
  AiGenerationError: class extends Error {
    constructor(public detail: { title: string; attempts: unknown[] }) {
      super('ai generation failed')
    }
  },
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: h.ensureKlpsReady }))
vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: h.safeProfileBlock }))

import { getOrGenerateMultipleChoiceOptions } from '@/actions/quiz'
import { MultipleChoiceOptionsSchema, MultipleChoiceKlpSchema } from '@/lib/ai/schemas'

const OWNER = 'user-owner'
const MODEL = 'gemini-3.6-flash'
const CORRECT = 'Weighted Average Cost of Capital'

const card = {
  id: 'card1',
  term: 'WACC',
  definition: CORRECT,
  setId: 'set1',
  klpVersion: 3,
}

const set = {
  id: 'set1',
  cards: [card, { id: 'card2', term: 'NPV', definition: 'Net Present Value', setId: 'set1' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.resolveTaskModel.mockResolvedValue(MODEL)
  h.safeProfileBlock.mockResolvedValue(undefined)
  h.cardFindUnique.mockResolvedValue(card)
  h.cardFindFirst.mockResolvedValue(card)
  h.setFindUnique.mockResolvedValue(set)
  // Owns the attempt by default; the dedicated ownership test overrides this.
  h.attemptFindFirst.mockResolvedValue({ id: 'attempt1' })
  h.cacheFindUnique.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
  h.questionUpsert.mockResolvedValue({})
  h.ensureKlpsReady.mockResolvedValue([])
})

describe('getOrGenerateMultipleChoiceOptions', () => {
  it('cache hit on a v2 blob returns without generating', async () => {
    h.cacheFindUnique.mockResolvedValue({
      options: {
        v: 2,
        correctAnswer: CORRECT,
        options: [
          { text: CORRECT, correct: true },
          { text: 'Wrong def A', correct: false, sourceKlpId: 'klp1', corruption: 'inversion' },
          { text: 'Wrong def B', correct: false, sourceKlpId: 'klp2', corruption: 'conflation' },
          { text: 'Wrong def C', correct: false, sourceKlpId: 'klp3', corruption: 'factual_error' },
        ],
      },
    })

    const result = await getOrGenerateMultipleChoiceOptions('card1')

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(h.generateJson).not.toHaveBeenCalled()
    expect(result.data.cacheHit).toBe(true)
    expect(result.data.correctAnswer).toBe(CORRECT)
    expect(result.data.options).toEqual([CORRECT, 'Wrong def A', 'Wrong def B', 'Wrong def C'])
  })

  it('cache hit on a legacy v1 blob also short-circuits', async () => {
    h.cacheFindUnique.mockResolvedValue({
      options: {
        options: [CORRECT, 'Wrong A', 'Wrong B', 'Wrong C'],
        correctAnswer: CORRECT,
      },
    })

    const result = await getOrGenerateMultipleChoiceOptions('card1')

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(h.generateJson).not.toHaveBeenCalled()
    expect(result.data.cacheHit).toBe(true)
    expect(result.data.options).toEqual([CORRECT, 'Wrong A', 'Wrong B', 'Wrong C'])
    expect(result.data.correctAnswer).toBe(CORRECT)
  })

  it('maps klpRef to the right sourceKlpId when persisting the cache blob', async () => {
    h.ensureKlpsReady.mockResolvedValue([
      { id: 'klp-real-0', index: 0, text: 'point zero', weight: 5, kind: 'definition' },
      { id: 'klp-real-1', index: 1, text: 'point one', weight: 3, kind: 'mechanism' },
    ])
    h.generateJson.mockResolvedValue({
      correctAnswer: CORRECT,
      distractors: [
        { text: 'Distractor for point 0', klpRef: 0, corruption: 'inversion' },
        { text: 'Distractor for point 1', klpRef: 1, corruption: 'conflation' },
        { text: 'Distractor also point 1', klpRef: 1, corruption: 'factual_error' },
      ],
    })

    const result = await getOrGenerateMultipleChoiceOptions('card1')

    expect(result.success).toBe(true)
    expect(h.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'distractors', schema: MultipleChoiceKlpSchema }),
    )

    // Assert on the actual persisted payload, not just that upsert was called.
    expect(h.cacheUpsert).toHaveBeenCalledTimes(1)
    const payload = h.cacheUpsert.mock.calls[0][0]
    expect(payload.create.options).toEqual(payload.update.options)
    const written: Array<{ text: string; correct: boolean; sourceKlpId?: string; corruption?: string }> =
      payload.create.options.options
    const byText = (t: string) => written.find((o) => o.text === t)!

    expect(byText('Distractor for point 0').sourceKlpId).toBe('klp-real-0')
    expect(byText('Distractor for point 0').corruption).toBe('inversion')
    expect(byText('Distractor for point 1').sourceKlpId).toBe('klp-real-1')
    expect(byText('Distractor for point 1').corruption).toBe('conflation')
    expect(byText('Distractor also point 1').sourceKlpId).toBe('klp-real-1')

    // The correct answer carries no provenance by design.
    expect(byText(CORRECT).sourceKlpId).toBeUndefined()
    expect(byText(CORRECT).correct).toBe(true)
  })

  it('an out-of-range klpRef yields no sourceKlpId rather than a bogus one', async () => {
    h.ensureKlpsReady.mockResolvedValue([
      { id: 'klp-real-0', index: 0, text: 'point zero', weight: 5, kind: 'definition' },
      { id: 'klp-real-1', index: 1, text: 'point one', weight: 3, kind: 'mechanism' },
    ])
    h.generateJson.mockResolvedValue({
      correctAnswer: CORRECT,
      distractors: [
        { text: 'Out of range', klpRef: 7, corruption: 'inversion' },
        { text: 'Valid zero', klpRef: 0, corruption: 'conflation' },
        { text: 'Valid one', klpRef: 1, corruption: 'factual_error' },
      ],
    })

    const result = await getOrGenerateMultipleChoiceOptions('card1')

    expect(result.success).toBe(true)
    const payload = h.cacheUpsert.mock.calls[0][0]
    const written: Array<{ text: string; sourceKlpId?: string }> = payload.create.options.options
    const oor = written.find((o) => o.text === 'Out of range')!

    expect(oor.sourceKlpId).toBeUndefined()
    expect(written.find((o) => o.text === 'Valid zero')!.sourceKlpId).toBe('klp-real-0')
    expect(written.find((o) => o.text === 'Valid one')!.sourceKlpId).toBe('klp-real-1')
  })

  it('writes a legacy v1 blob when the card has no KLPs', async () => {
    h.ensureKlpsReady.mockResolvedValue([])
    h.generateJson.mockResolvedValue({
      options: [CORRECT, 'Wrong A', 'Wrong B', 'Wrong C'],
      correctAnswer: CORRECT,
    })

    const result = await getOrGenerateMultipleChoiceOptions('card1')

    expect(result.success).toBe(true)
    expect(h.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'distractors', schema: MultipleChoiceOptionsSchema }),
    )

    const payload = h.cacheUpsert.mock.calls[0][0]
    expect(payload.create.options).toEqual({
      options: [CORRECT, 'Wrong A', 'Wrong B', 'Wrong C'],
      correctAnswer: CORRECT,
    })
    expect(payload.create.options.v).toBeUndefined()

    if (!result.success) throw new Error(result.error)
    expect(result.data.options).toEqual([CORRECT, 'Wrong A', 'Wrong B', 'Wrong C'])
  })

  it("rejects a card the user does not own, before the cache read and any KLP write", async () => {
    // The owner-scoped findFirst finds nothing. Even a warm cache must not
    // short-circuit past this: the check runs first.
    h.cardFindFirst.mockResolvedValue(null)
    h.cacheFindUnique.mockResolvedValue({
      options: { options: ['a', 'b', 'c', 'd'], correctAnswer: 'a' },
    })

    const result = await getOrGenerateMultipleChoiceOptions('card-not-mine', 'attempt1')

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Card not found')
    expect(h.cardFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-not-mine', set: { userId: OWNER } },
      }),
    )
    // No KLP extraction, no generation, no cache write, no question row.
    expect(h.ensureKlpsReady).not.toHaveBeenCalled()
    expect(h.generateJson).not.toHaveBeenCalled()
    expect(h.cacheUpsert).not.toHaveBeenCalled()
    expect(h.questionUpsert).not.toHaveBeenCalled()
  })

  it('recordQuizQuestion failing does not fail the question', async () => {
    h.questionUpsert.mockRejectedValue(new Error('db exploded'))
    h.ensureKlpsReady.mockResolvedValue([])
    h.generateJson.mockResolvedValue({
      options: [CORRECT, 'Wrong A', 'Wrong B', 'Wrong C'],
      correctAnswer: CORRECT,
    })

    // attemptId supplied so recordQuizQuestion actually attempts the write
    // (and rejects) rather than no-op'ing.
    const result = await getOrGenerateMultipleChoiceOptions('card1', 'attempt1')

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.options).toEqual([CORRECT, 'Wrong A', 'Wrong B', 'Wrong C'])
    expect(result.data.correctAnswer).toBe(CORRECT)
    expect(h.questionUpsert).toHaveBeenCalledTimes(1)
  })
})
