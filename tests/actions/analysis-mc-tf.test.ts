import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to submitMultipleChoiceAnswer and submitTrueFalseAnswer's analysis
// capture only — quiz.ts is large and tangled; the other exports are out of
// scope for this file. Follows the mocking pattern in
// tests/actions/true-false.test.ts and tests/actions/analysis-short-answer.test.ts.
//
// `cardFindUnique` resolves null in every test here: the card is only used to
// build the MC/TF *feedback* string (a separate, unrelated AI call), and
// forcing it away lets "never calls generateJson" assert a genuinely zero-call
// path rather than depending on that branch's own success/failure.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
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
vi.mock('@/lib/quiz/coin-flip', () => ({ pickTfVariant: vi.fn() }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))

import { submitMultipleChoiceAnswer, submitTrueFalseAnswer } from '@/actions/quiz'
import { BKT_PRIOR } from '@/lib/metrics/bkt'

const OWNER = 'user-owner'
const ATTEMPT_ID = 'attempt1'
const CARD_ID = 'card1'
const SESSION_ID = 'session1'

// Three KLPs a single MC question targets, one per distractor.
const klps = [
  { id: 'klp-a', index: 0, text: 'point A', weight: 5, kind: 'definition' },
  { id: 'klp-b', index: 1, text: 'point B', weight: 4, kind: 'mechanism' },
  { id: 'klp-picked', index: 2, text: 'point picked', weight: 3, kind: 'definition' },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.attemptFindFirst.mockResolvedValue({ sessionId: SESSION_ID })
  h.answerDeleteMany.mockResolvedValue({ count: 0 })
  h.answerFindMany.mockResolvedValue([])
  h.answerFindFirst.mockResolvedValue(null)
  h.attemptUpdate.mockResolvedValue({})
  h.attemptUpdateMany.mockResolvedValue({})
  h.cardFindUnique.mockResolvedValue(null)
  h.progressFindUnique.mockResolvedValue(null)
  h.ensureKlpsReady.mockResolvedValue(klps)
  h.answerCreate.mockImplementation(async ({ data }: any) => ({ id: 'answer-1', ...data }))
  h.klpResultCreateMany.mockResolvedValue({ count: 0 })
  h.errorTagCreateMany.mockResolvedValue({ count: 0 })
  h.klpStateFindUnique.mockResolvedValue(null)
  h.klpStateUpsert.mockResolvedValue({})
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      quizAnswer: { create: h.answerCreate },
      answerKlpResult: { createMany: h.klpResultCreateMany },
      answerErrorTag: { createMany: h.errorTagCreateMany },
      klpState: { findUnique: h.klpStateFindUnique, upsert: h.klpStateUpsert },
    }),
  )
})

// A v2 option cache reconstructed on QuizQuestion.options: the correct answer
// plus one distractor per KLP, each carrying its provenance.
const mcOptions = [
  { text: 'The Correct Answer', correct: true },
  { text: 'Distractor A', correct: false, sourceKlpId: 'klp-a', corruption: 'factual_error' },
  { text: 'Distractor B', correct: false, sourceKlpId: 'klp-b', corruption: 'misapplication' },
  { text: 'Distractor Picked', correct: false, sourceKlpId: 'klp-picked', corruption: 'inversion' },
]

describe('submitMultipleChoiceAnswer analysis capture', () => {
  it('never calls generateJson for MC/TF analysis', async () => {
    // The entire point: a wrong pick is self-diagnosing because the generator
    // already recorded what each distractor was built to corrupt.
    h.questionFindUnique.mockResolvedValue({
      options: mcOptions,
      targetKlpIds: ['klp-a', 'klp-b', 'klp-picked'],
    })

    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'Distractor Picked',
      correctAnswer: 'The Correct Answer',
    })

    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('writes one failed result for the PICKED distractor only', async () => {
    // The question targeted 3 KLPs. Rejecting the other two distractors
    // carries no information — the learner rejected the correct answer too.
    h.questionFindUnique.mockResolvedValue({
      options: mcOptions,
      targetKlpIds: ['klp-a', 'klp-b', 'klp-picked'],
    })

    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'Distractor Picked',
      correctAnswer: 'The Correct Answer',
    })

    const rows = h.klpResultCreateMany.mock.calls[0][0].data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ klpId: 'klp-picked', status: 'failed', credit: 0 })

    const tags = h.errorTagCreateMany.mock.calls[0][0].data
    expect(tags).toHaveLength(1)
    expect(tags[0]).toMatchObject({ dimension: 'accuracy', type: 'inversion', klpId: 'klp-picked' })

    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('analyzed')
  })

  it('MC correct: credits every targeted KLP at 0.75, no error tags', async () => {
    h.questionFindUnique.mockResolvedValue({
      options: mcOptions,
      targetKlpIds: ['klp-a', 'klp-b', 'klp-picked'],
    })

    const result = await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'The Correct Answer',
      correctAnswer: 'The Correct Answer',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(true)

    const rows = h.klpResultCreateMany.mock.calls[0][0].data
    expect(rows).toHaveLength(3)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ klpId: 'klp-a', status: 'passed', credit: 0.75, mode: 'quiz-mc' }),
        expect.objectContaining({ klpId: 'klp-b', status: 'passed', credit: 0.75, mode: 'quiz-mc' }),
        expect.objectContaining({ klpId: 'klp-picked', status: 'passed', credit: 0.75, mode: 'quiz-mc' }),
      ]),
    )
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()
  })

  it('MC wrong, no provenance: records analysisStatus no_provenance and no rows', async () => {
    // A legacy v1 cache row: QuizQuestion.options reconstructed as a plain
    // string array. It fails the v2 shape (which needs {text, correct, ...}
    // objects) and falls back to the v1 schema, so parseOptionCache reports
    // version 1 — the signal that nothing here can be attributed to a KLP.
    h.questionFindUnique.mockResolvedValue({
      options: ['The Correct Answer', 'Option B', 'Option C', 'Option D'],
      targetKlpIds: [],
    })

    const result = await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'Option B',
      correctAnswer: 'The Correct Answer',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(false)

    expect(h.klpResultCreateMany).not.toHaveBeenCalled()
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()
    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('no_provenance')
  })
})

describe('submitTrueFalseAnswer analysis capture', () => {
  it('TF correct: credits every targeted KLP at 0.50, no error tags', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'point A and point B, correctly stated.',
      isTrue: true,
      corruption: null,
      targetKlpIds: ['klp-a', 'klp-b'],
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(true)

    const rows = h.klpResultCreateMany.mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ klpId: 'klp-a', status: 'passed', credit: 0.5, mode: 'quiz-tf' }),
        expect.objectContaining({ klpId: 'klp-b', status: 'passed', credit: 0.5, mode: 'quiz-tf' }),
      ]),
    )
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()
  })

  it('TF wrong, shown corrupted, answered "true": one failed KLP result and one error tag', async () => {
    h.questionFindUnique.mockResolvedValue({
      statement: 'point picked, corrupted.',
      isTrue: false,
      corruption: 'conflation',
      targetKlpIds: ['klp-picked'],
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(false)

    const rows = h.klpResultCreateMany.mock.calls[0][0].data
    expect(rows).toEqual([expect.objectContaining({ klpId: 'klp-picked', status: 'failed', credit: 0 })])

    const tags = h.errorTagCreateMany.mock.calls[0][0].data
    expect(tags).toEqual([
      expect.objectContaining({ dimension: 'accuracy', type: 'conflation', klpId: 'klp-picked', severity: 4 }),
    ])
  })

  it('writes NO KLP result when "false" was answered to the real definition', async () => {
    // Rejecting a TRUE statement is second-guessing, not a knowledge gap.
    // Recording `failed` would teach Spec 3 the learner lacks a proposition
    // they may well hold. See docs/ai/error-taxonomy.md §4.
    h.questionFindUnique.mockResolvedValue({
      statement: 'point A and point B, correctly stated.',
      isTrue: true,
      corruption: null,
      targetKlpIds: ['klp-a', 'klp-b'],
    })

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'false',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBe(false)

    expect(h.klpResultCreateMany).not.toHaveBeenCalled()
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()

    // Rejecting a true statement is second-guessing, not a knowledge gap —
    // a clean, fully-analyzed row with nothing to blame, NOT `no_provenance`
    // (which means the row couldn't be read at all).
    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('analyzed')
  })

  it('an unscored TF answer (no QuizQuestion row) writes no analysis', async () => {
    h.questionFindUnique.mockResolvedValue(null)

    const result = await submitTrueFalseAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'true',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.isCorrect).toBeNull()

    expect(h.klpResultCreateMany).not.toHaveBeenCalled()
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()
    expect(h.generateJson).not.toHaveBeenCalled()

    // Missing data (no answer key at all), not a by-design non-finding — must
    // NOT be recorded as a clean `analyzed` row, or Spec 3's rate
    // calculations would silently count an unevaluated answer as evaluated.
    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('no_provenance')
  })
})

describe('KlpState is stepped forward by the same transaction', () => {
  // The C1 bug: KlpState had a READER (src/lib/metrics/read.ts) and no writer
  // anywhere in production. `knowledge` was permanently `{}`, so every topic's
  // knowledge read null forever AND computeArticulation booked every
  // `too_terse` as a knowledge gap — the signed verbosity index could never go
  // negative, which is the spec's headline deliverable.
  const ANSWERED_AT = new Date('2026-08-05T12:00:00.000Z')

  beforeEach(() => {
    h.answerCreate.mockImplementation(async ({ data }: any) => ({
      id: 'answer-1', createdAt: ANSWERED_AT, ...data,
    }))
    h.questionFindUnique.mockResolvedValue({
      options: mcOptions,
      targetKlpIds: ['klp-a', 'klp-b', 'klp-picked'],
    })
  })

  it('upserts a state for every KLP the answer credited', async () => {
    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'The Correct Answer',
      correctAnswer: 'The Correct Answer',
    })

    expect(h.klpStateUpsert).toHaveBeenCalledTimes(3)
    const written = h.klpStateUpsert.mock.calls.map((c: any) => c[0])
    expect(written.map((w: any) => w.create.klpId).sort()).toEqual(['klp-a', 'klp-b', 'klp-picked'])
    for (const w of written) {
      expect(w.create.userId).toBe(OWNER)
      // One observation counted, not a bare prior row: a state that looks
      // materialized but carries no evidence is indistinguishable at read time
      // from a learner who was never observed.
      expect(w.create.observations).toBe(1)
      expect(w.update.observations).toBe(1)
      expect(w.create.lastObservedAt).toEqual(ANSWERED_AT)
    }
  })

  it('upserts only the failed KLP for a wrong pick', async () => {
    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'Distractor Picked',
      correctAnswer: 'The Correct Answer',
    })

    expect(h.klpStateUpsert).toHaveBeenCalledTimes(1)
    const write = h.klpStateUpsert.mock.calls[0][0] as any
    expect(write.create.klpId).toBe('klp-picked')
    // A failure must be able to drive the posterior DOWN, or knowledge can
    // only ever grow and terseness can never be read as an expression gap.
    expect(write.create.pKnown).toBeLessThan(BKT_PRIOR)
  })

  it('steps an existing state forward instead of restarting from the prior', async () => {
    h.klpStateFindUnique.mockImplementation(async ({ where }: any) => ({
      userId: OWNER,
      klpId: where.userId_klpId.klpId,
      pKnown: 0.8,
      observations: 7,
      lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
    }))

    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'Distractor Picked',
      correctAnswer: 'The Correct Answer',
    })

    const write = h.klpStateUpsert.mock.calls[0][0] as any
    expect(write.update.observations).toBe(8)
    expect(write.update.pKnown).toBeLessThan(0.8)
  })

  it('writes no state when the answer attributed nothing', async () => {
    // A v1 cache row: no provenance, so nothing to attribute. Fabricating an
    // observation here would promote knowledge the learner never demonstrated.
    h.questionFindUnique.mockResolvedValue(null)

    await submitMultipleChoiceAnswer({
      attemptId: ATTEMPT_ID,
      cardId: CARD_ID,
      selectedOption: 'Distractor Picked',
      correctAnswer: 'The Correct Answer',
    })

    expect(h.klpStateUpsert).not.toHaveBeenCalled()
  })
})
