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
  // Spec 5 Phase A: the three new answer-child tables.
  relationResultCreateMany: vi.fn(),
  formResultCreateMany: vi.fn(),
  unwarrantedCreateMany: vi.fn(),
  klpStateFindUnique: vi.fn(),
  klpStateUpsert: vi.fn(),
  // B2: the prior answer is superseded INSIDE the write transaction now, and
  // the KLPs its cascaded-away results credited are replayed from surviving
  // history. tests/actions/quiz-resubmit-state.test.ts owns that behaviour;
  // here both reads default to empty so the replay is a no-op.
  txPriorFindMany: vi.fn(),
  txKlpResultFindMany: vi.fn(),
  klpStateDeleteMany: vi.fn(),
  // Task 8: the grading context — relations, form requirements and the
  // reference answer — loaded beside the live KLPs.
  relationFindMany: vi.fn(),
  formReqFindMany: vi.fn(),
  authoringFindFirst: vi.fn(),
  // Spec 5 "The boundary": the grader never sees the learner. Held here so a
  // test can assert the profile fetch is gone from the grading path.
  safeProfileBlock: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst, update: h.attemptUpdate },
    quizAnswer: { deleteMany: h.answerDeleteMany, findMany: h.answerFindMany },
    card: { findUnique: h.cardFindUnique },
    cardProgress: { findUnique: h.progressFindUnique },
    klpRelation: { findMany: h.relationFindMany },
    cardFormRequirement: { findMany: h.formReqFindMany },
    cardAuthoring: { findFirst: h.authoringFindFirst },
    // The transaction callback receives a tx object exposing just the three
    // models createAnswerWithAnalysis writes through.
    $transaction: h.transaction,
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  // Delegates to the same mock so a test that stubs `generateJson` also
  // covers the with-meta variant. `meta.model` is what the production code
  // now persists onto the artifact.
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
vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: h.safeProfileBlock }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: vi.fn() }))

import { submitShortAnswer } from '@/actions/quiz'
import { GRADER_VERSION } from '@/lib/analysis/version'
import { gradeMaxOutputTokens } from '@/lib/analysis/output-cap'

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

const klps = [{ id: 'klp-a', index: 0, text: 'x', weight: 5, kind: 'definition', label: null, version: 2 }]

/** An AiGenerationError-shaped failure: the retry path reads `detail.attempts[].kind`. */
function aiFailure(kind: string, value?: string) {
  return Object.assign(new Error(kind), { detail: { title: kind, attempts: [{ kind }], value } })
}

/** A card with one relation and one form requirement authored at the live version. */
function mockGradingContext() {
  h.ensureKlpsReady.mockResolvedValue([
    { id: 'klp-a', index: 0, text: 'x', weight: 5, kind: 'definition', label: null, version: 2 },
    { id: 'klp-b', index: 1, text: 'y', weight: 3, kind: 'mechanism', label: null, version: 2 },
  ])
  h.relationFindMany.mockResolvedValue([{ id: 'rel-1', type: 'causes', fromKlpId: 'klp-a', toKlpId: 'klp-b' }])
  h.formReqFindMany.mockResolvedValue([{ id: 'form-1', index: 0, text: 'Names the formula' }])
  h.authoringFindFirst.mockResolvedValue({ referenceAnswer: 'The strong reference answer.' })
}

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
  // `clearAllMocks` keeps a queued `mockRejectedValueOnce` alive across tests;
  // the retry tests below queue several, and a leftover would leak into the
  // next test's first grading call.
  h.generateJson.mockReset()
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
  h.relationResultCreateMany.mockResolvedValue({ count: 0 })
  h.formResultCreateMany.mockResolvedValue({ count: 0 })
  h.unwarrantedCreateMany.mockResolvedValue({ count: 0 })
  h.klpStateFindUnique.mockResolvedValue(null)
  h.klpStateUpsert.mockResolvedValue({})
  h.txPriorFindMany.mockResolvedValue([])
  h.txKlpResultFindMany.mockResolvedValue([])
  h.klpStateDeleteMany.mockResolvedValue({ count: 0 })
  h.relationFindMany.mockResolvedValue([])
  h.formReqFindMany.mockResolvedValue([])
  h.authoringFindFirst.mockResolvedValue(null)
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
      answerRelationResult: { createMany: h.relationResultCreateMany },
      answerFormResult: { createMany: h.formResultCreateMany },
      answerUnwarrantedClaim: { createMany: h.unwarrantedCreateMany },
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
      // A legacy `passed` draft lands as `correct`: no v4 row says passed.
      expect.objectContaining({ klpId: 'klp-a', status: 'correct', credit: 0.95, mode: 'quiz-sa' }),
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

  it('stamps graderVersion on the answer row (Spec 5 §6)', async () => {
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'correct' }],
      errorTags: [],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.answerCreate.mock.calls[0][0].data.graderVersion).toBe(GRADER_VERSION)
  })

  it('resolves the grader quote to a span over the SUBMITTED answer text', async () => {
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'inversion', quote: 'cost of debt' }],
      errorTags: [],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'WACC is the cost of debt only' })

    expect(h.klpResultCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      klpId: 'klp-a', status: 'inversion', credit: 0, evidence: 'cost of debt', spanStart: 12, spanEnd: 24,
    })
  })

  it('writes an unwarranted claim through its own table and docks key-point credit', async () => {
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'correct' }],
      errorTags: [],
      unwarranted: [{ text: 'says WACC ignores equity', quote: 'ignores equity', magnitude: 10 }],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'WACC ignores equity' })

    expect(h.unwarrantedCreateMany).toHaveBeenCalledTimes(1)
    expect(h.unwarrantedCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        quizAnswerId: 'answer-1', text: 'says WACC ignores equity', magnitude: 10, spanStart: 5, spanEnd: 19,
      }),
    ])
    // Full dock: 0.95 x 0.5. The claim never became an error tag.
    expect(h.klpResultCreateMany.mock.calls[0][0].data[0].credit).toBeCloseTo(0.475)
    expect(h.errorTagCreateMany).not.toHaveBeenCalled()
  })

  it('records a relation or form verdict the card cannot resolve as a warning, never a row', async () => {
    // The grader's arrays reach buildAnalysisWrites; on a card with no
    // relations / form requirements every such ref is unresolvable —
    // recorded as a warning on the answer, never fabricated into a row.
    h.generateJson.mockResolvedValue({
      ...gradeShape,
      klpResults: [{ klpRef: 0, status: 'correct' }],
      errorTags: [],
      relationResults: [{ relationRef: 0, status: 'correct', quote: 'text' }],
      formResults: [{ formRef: 0, status: 'met' }],
    })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.relationResultCreateMany).not.toHaveBeenCalled()
    expect(h.formResultCreateMany).not.toHaveBeenCalled()
    const data = h.answerCreate.mock.calls[0][0].data
    expect(data.analysisWarnings).toContainEqual({ reason: 'unresolved_relation_ref', value: '0' })
    expect(data.analysisWarnings).toContainEqual({ reason: 'unresolved_form_ref', value: '0' })
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

describe('submitShortAnswer grades through the content pass (Spec 5 Phase A, Task 8)', () => {
  const gradeWithContext = {
    ...gradeShape,
    klpResults: [
      { klpRef: 0, status: 'correct' },
      { klpRef: 1, status: 'omission', quote: 'x' },
    ],
    errorTags: [],
    relationResults: [{ relationRef: 0, status: 'correct', quote: 'WACC drives' }],
    formResults: [{ formRef: 0, status: 'met', quote: 'WACC' }],
    unwarranted: [{ text: 'invents a tax shield', quote: 'tax shield', magnitude: 4 }],
  }
  const ANSWER = 'WACC drives the tax shield'

  it('shows the grader the card relations, form requirements and reference answer by ref', async () => {
    mockGradingContext()
    h.generateJson.mockResolvedValue(gradeWithContext)

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    const prompt: string = h.generateJson.mock.calls[0][0].prompt
    expect(prompt).toContain('[R0] (causes) [0] → [1]')
    expect(prompt).toContain('[F0] Names the formula')
    expect(prompt).toContain('The strong reference answer.')
    // Refs, never ids: a cuid in the prompt is a cuid the grader can echo back.
    expect(prompt).not.toContain('rel-1')
    expect(prompt).not.toContain('form-1')
  })

  it('sizes the output ceiling to key points + relations + form requirements', async () => {
    mockGradingContext()
    h.generateJson.mockResolvedValue(gradeWithContext)

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    expect(h.generateJson.mock.calls[0][0].maxOutputTokens).toBe(gradeMaxOutputTokens(2 + 1 + 1))
  })

  it('sizes the ceiling to the key points alone on a card with no relations or form requirements', async () => {
    h.generateJson.mockResolvedValue({ ...gradeShape, klpResults: [{ klpRef: 0, status: 'correct' }], errorTags: [] })

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(h.generateJson.mock.calls[0][0].maxOutputTokens).toBe(gradeMaxOutputTokens(1))
  })

  it('persists relation, form and unwarranted rows against the real ids', async () => {
    mockGradingContext()
    h.generateJson.mockResolvedValue(gradeWithContext)

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    expect(h.relationResultCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        quizAnswerId: 'answer-1', relationId: 'rel-1', status: 'correct', provenance: 'passive', spanStart: 0, spanEnd: 11,
      }),
    ])
    expect(h.formResultCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ quizAnswerId: 'answer-1', formRequirementId: 'form-1', status: 'met', spanStart: 0, spanEnd: 4 }),
    ])
    expect(h.unwarrantedCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ quizAnswerId: 'answer-1', text: 'invents a tax shield', magnitude: 4 }),
    ])
    const data = h.answerCreate.mock.calls[0][0].data
    expect(data.analysisStatus).toBe('analyzed')
    expect(data.analysisWarnings ?? []).not.toContainEqual(expect.objectContaining({ reason: 'unresolved_relation_ref' }))
    expect(data.analysisWarnings ?? []).not.toContainEqual(expect.objectContaining({ reason: 'unresolved_form_ref' }))
  })

  it('never fetches the learner profile for grading (Spec 5, "The boundary")', async () => {
    mockGradingContext()
    h.generateJson.mockResolvedValue(gradeWithContext)

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    expect(h.safeProfileBlock).not.toHaveBeenCalled()
  })

  it('wires the multimodal branch through the same context', async () => {
    mockGradingContext()
    h.cardFindUnique.mockResolvedValue({
      ...card,
      contentBlocks: [{ side: 'term', type: 'image', text: null, assetId: 'asset1', position: 0 }],
    })
    h.generateJson.mockResolvedValue(gradeWithContext)

    await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    const sent = JSON.stringify(h.generateJson.mock.calls[0][0].parts)
    expect(sent).toContain('[R0] (causes) [0] → [1]')
    expect(sent).toContain('[F0] Names the formula')
    expect(h.generateJson.mock.calls[0][0].maxOutputTokens).toBe(gradeMaxOutputTokens(2 + 1 + 1))
    expect(h.relationResultCreateMany.mock.calls[0][0].data[0]).toMatchObject({ relationId: 'rel-1' })
    expect(h.formResultCreateMany.mock.calls[0][0].data[0]).toMatchObject({ formRequirementId: 'form-1' })
    expect(h.safeProfileBlock).not.toHaveBeenCalled()
  })

  it('retries a schema_invalid grade ONCE in place and uses the second reply (D6)', async () => {
    mockGradingContext()
    h.generateJson
      .mockRejectedValueOnce(aiFailure('schema_invalid', 'bogus_label'))
      .mockResolvedValueOnce(gradeWithContext)

    const result = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    expect(result.success).toBe(true)
    // Two grading calls, then the annotation call.
    expect(h.generateJson.mock.calls[0][0].schema).toBe(h.generateJson.mock.calls[1][0].schema)
    expect(h.generateJson.mock.calls[0][0].prompt).toBe(h.generateJson.mock.calls[1][0].prompt)
    expect(h.answerCreate).toHaveBeenCalledTimes(1)
    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('analyzed')
    expect(h.relationResultCreateMany).toHaveBeenCalledTimes(1)
  })

  it('fails loudly after the second schema_invalid: a failed row naming the unknown label, no third try', async () => {
    mockGradingContext()
    h.generateJson
      .mockRejectedValueOnce(aiFailure('schema_invalid', 'bogus_label'))
      .mockRejectedValueOnce(aiFailure('schema_invalid', 'bogus_label'))

    const result = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    expect(result.success).toBe(false)
    // Exactly two grading attempts; the annotation call never runs because
    // grading threw.
    expect(h.generateJson).toHaveBeenCalledTimes(2)
    const data = h.answerCreate.mock.calls[0][0].data
    expect(data.analysisStatus).toBe('failed')
    expect(data.analysisWarnings).toContainEqual({ reason: 'unknown_status', value: 'bogus_label' })
  })

  it('does NOT retry an output_truncated grade in place — that is the ceiling, not compliance', async () => {
    mockGradingContext()
    h.generateJson.mockRejectedValueOnce(aiFailure('output_truncated'))

    const result = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: ANSWER })

    expect(result.success).toBe(false)
    expect(h.generateJson).toHaveBeenCalledTimes(1)
    expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('failed')
  })

  it('does not retry any other grading failure', async () => {
    h.generateJson.mockRejectedValueOnce(aiFailure('quota_exhausted'))

    const result = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

    expect(result.success).toBe(false)
    expect(h.generateJson).toHaveBeenCalledTimes(1)
  })
})
