import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to submitShortAnswer only — quiz.ts is large and tangled; the other
// exports are out of scope for this file. Follows the pattern in
// tests/actions/quiz-options.test.ts and tests/actions/true-false.test.ts.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  // The advisory lock taken before any posterior read (B9).
  txExecuteRaw: vi.fn(),
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
  klpStateFindUnique: vi.fn(),
  klpStateUpsert: vi.fn(),
  // B2: the prior answer is superseded INSIDE the write transaction now, and
  // the KLPs its cascaded-away results credited are replayed from surviving
  // history. tests/actions/quiz-resubmit-state.test.ts owns that behaviour;
  // here both reads default to empty so the replay is a no-op.
  txPriorFindMany: vi.fn(),
  txKlpResultFindMany: vi.fn(),
  klpStateDeleteMany: vi.fn(),
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
      // lockKlpStates uses $executeRaw: pg_advisory_xact_lock returns void, which
      // $queryRaw cannot deserialize under the Neon adapter (see state-writer.ts).
      $executeRaw: h.txExecuteRaw,
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
    // The load-bearing test. The AI's only numeric input is magnitude (1-10);
    // if it could influence relevance it could inflate its own significance.
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [],
      // inversion band [2,5]; magnitude 7 -> floor 2 + 3*(6/9) = 4.
      errorTags: [{ dimension: 'accuracy', type: 'inversion', klpRef: 0, magnitude: 7, relevance: 99 }],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    const tag = h.errorTagCreateMany.mock.calls[0][0].data[0]
    expect(tag.relevance).toBe(5) // the KLP's stored weight
    expect(tag.severity).toBe(4)
    expect(tag.magnitude).toBe(7)
    expect(tag.mode).toBe('quiz-sa')
    expect(tag.significance).toBe(9) // round((.55*5 + .45*4) * 2 * 1.0)
  })

  it('drops an unknown type, keeps the answer, and names the rejection', async () => {
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      // Non-empty so this test isolates ONLY the invalid-tag-drop behavior —
      // an empty klpResults on a card with live KLPs now triggers a SEPARATE
      // no_provenance rule (see the dedicated test for that below), which
      // would otherwise mask what this test is actually checking.
      klpResults: [{ klpRef: 0, status: 'passed' }],
      errorTags: [{ dimension: 'accuracy', type: 'vibes', klpRef: 0, magnitude: 3 }],
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

  it('records no_provenance, NOT analyzed, when the card has live KLPs but the grader returns none', async () => {
    // The spec's own rule ("Short answer... one row per KLP on the card, the
    // grader evaluated each") means an empty klpResults on a card WITH KLPs
    // is never a legitimately clean grade — the grader just didn't do the
    // per-KLP judgment it was asked for. Unlike no_klps (a card fact), this
    // is a data-quality fact about THIS response, so it must not read as a
    // clean 'analyzed' answer.
    h.generateJson.mockResolvedValue({ ...gradeShape, klpResults: [], errorTags: [] })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('no_provenance')
    expect(h.klpResultCreateMany).not.toHaveBeenCalled()
  })

  it('routes the multimodal branch through the shared analysis-write helper', async () => {
    // Confirms the multimodal branch calls createAnswerWithAnalysis at all
    // (would catch a copy-paste omission of the write-path wiring on this
    // branch). It does NOT prove the grader was actually asked for analysis —
    // generateJson is mocked unconditionally below and returns klpResults
    // regardless of the prompt text, so this alone would have passed against
    // the pre-fix buildParts too. See the next test for that half.
    // Drive the multimodal branch by giving the card a non-text term block.
    h.cardFindUnique.mockResolvedValue({
      ...card,
      contentBlocks: [{ side: 'term', type: 'image', text: null, assetId: 'asset1', position: 0 }],
    })
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'passed' }],
      errorTags: [],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.klpResultCreateMany).toHaveBeenCalled()
  })

  it('asks the grader for analysis on the multimodal path, not just the text path', async () => {
    // The regression this guards: buildParts once had no `klps` parameter, so
    // a multimodal answer recorded analysisStatus 'analyzed' with zero tags —
    // an unanalyzed answer counted as clean. The test above cannot catch that
    // (generateJson is mocked unconditionally and returns klpResults
    // regardless of what the prompt asked for), so assert on the prompt text
    // actually handed to the grader instead.
    h.cardFindUnique.mockResolvedValue({
      ...card,
      contentBlocks: [{ side: 'term', type: 'image', text: null, assetId: 'asset1', position: 0 }],
    })
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'passed' }],
      errorTags: [],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    // The multimodal path calls generateJson with `parts` (not `prompt`) as
    // its first call (grading, before the annotation call).
    const sentParts = h.generateJson.mock.calls[0][0].parts
    expect(JSON.stringify(sentParts)).toContain('klpResults')
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

  it('resubmitting leaves exactly one set of analysis rows, not two', async () => {
    // Spec 2a §4.1: "A test must pin that" resubmission doesn't orphan or
    // duplicate analysis rows. tests/schema/answer-analysis-cascade.test.ts
    // pins that AnswerKlpResult/AnswerErrorTag declare `onDelete: Cascade`
    // from QuizAnswer; this test simulates that cascade with a tiny in-memory
    // store (this repo has no real-database integration tests to exercise it
    // for real) and proves the delete-then-create flow that config depends on
    // doesn't accumulate rows across a resubmit.
    let nextId = 0
    let answers: { id: string }[] = []
    let klpResults: { quizAnswerId: string }[] = []
    let errorTags: { quizAnswerId: string }[] = []

    h.answerDeleteMany.mockImplementation(async () => {
      // Scoped by attemptId/cardId/mode in the real query; every row in this
      // test matches, so delete-all mirrors the production WHERE clause.
      const deletedIds = answers.map((a) => a.id)
      answers = []
      // The cascade under test: removing the QuizAnswer removes its children.
      klpResults = klpResults.filter((r) => !deletedIds.includes(r.quizAnswerId))
      errorTags = errorTags.filter((t) => !deletedIds.includes(t.quizAnswerId))
      return { count: deletedIds.length }
    })
    h.answerCreate.mockImplementation(async ({ data }: any) => {
      const answer = { id: `answer-${nextId++}`, ...data }
      answers.push(answer)
      return answer
    })
    h.klpResultCreateMany.mockImplementation(async ({ data }: any) => {
      klpResults.push(...data)
      return { count: data.length }
    })
    h.errorTagCreateMany.mockImplementation(async ({ data }: any) => {
      errorTags.push(...data)
      return { count: data.length }
    })

    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'passed' }],
      errorTags: [{ dimension: 'accuracy', type: 'inversion', klpRef: 0, magnitude: 3 }],
    })
    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'first try' })
    expect(answers).toHaveLength(1)
    expect(klpResults).toHaveLength(1)
    expect(errorTags).toHaveLength(1)

    // Resubmit with a DIFFERENT grade — if the old rows weren't cascaded away,
    // the counts below would be 2, not 1, and a stale row from the first
    // attempt would sit alongside the new one.
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'failed' }],
      errorTags: [],
    })
    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'second try' })

    expect(answers).toHaveLength(1)
    expect(klpResults).toHaveLength(1)
    expect(klpResults[0]).toMatchObject({ status: 'failed' }) // the SECOND grade, not the first
    expect(errorTags).toHaveLength(0) // the stale tag from the first attempt is gone
  })

  it('records analysisStatus failed when grading itself throws, and still returns success: false', async () => {
    // Previously: a grading failure threw straight out of the action with no
    // row ever created, so the spec's own degradation table ("No AI
    // credential -> failed") described intended, not actual, behavior.
    h.generateJson.mockRejectedValue(new Error('grading blew up'))

    const result = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    // Client-facing contract is UNCHANGED — still a plain failure the UI
    // already knows how to show, just with a row now recorded behind it.
    expect(result.success).toBe(false)

    expect(h.answerCreate).toHaveBeenCalledTimes(1)
    const data = h.answerCreate.mock.calls[0][0].data
    expect(data.analysisStatus).toBe('failed')
    expect(data.score).toBeNull()
    expect(data.isCorrect).toBeNull()
    expect(h.klpResultCreateMany).not.toHaveBeenCalled()
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()
  })

  it('does not record a failed row for an unrelated pre-grading failure', async () => {
    // The failed-row bookkeeping is scoped to the grading call specifically —
    // a card lookup failure (or any other pre-grading error) must not
    // fabricate a "grading failed" row for an answer that was never graded.
    h.cardFindUnique.mockResolvedValue(null)

    const result = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(result.success).toBe(false)
    expect(h.answerCreate).not.toHaveBeenCalled()
  })
})
