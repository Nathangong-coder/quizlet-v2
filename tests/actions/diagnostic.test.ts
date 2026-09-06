import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class MockAiGenerationError extends Error {
    detail: { title: string; why: string }

    constructor(detail: { title: string; why: string }) {
      super(detail.title)
      this.name = 'AiGenerationError'
      this.detail = detail
    }
  }

  return {
    auth: vi.fn(),
    setFindMany: vi.fn(),
    setFindFirst: vi.fn(),
    cardKlpFindMany: vi.fn(),
    klpStateFindMany: vi.fn(),
    cardProgressFindMany: vi.fn(),
    quizAttemptFindFirst: vi.fn(),
    diagnosticFindFirst: vi.fn(),
    generateJson: vi.fn(),
    transaction: vi.fn(),
    recordStudyEvent: vi.fn(),
    createAnswerWithAnalysis: vi.fn(),
    ensureKlpsReady: vi.fn(),
    AiGenerationError: MockAiGenerationError,
  }
})

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    set: { findMany: h.setFindMany, findFirst: h.setFindFirst },
    cardKlp: { findMany: h.cardKlpFindMany },
    klpState: { findMany: h.klpStateFindMany },
    cardProgress: { findMany: h.cardProgressFindMany },
    quizAttempt: { findFirst: h.quizAttemptFindFirst },
    diagnosticAttempt: { findFirst: h.diagnosticFindFirst },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  // Delegates to the same mock, so a test that stubs `generateJson` also
  // covers the with-meta variant the production code now uses.
  generateJsonWithMeta: async (...args: unknown[]) => ({
    value: await h.generateJson(...args),
    meta: { model: 'test-model', provider: 'google', credentialId: 'cred-1' },
  }),
  AiGenerationError: h.AiGenerationError,
}))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))
vi.mock('@/lib/analysis/write-answer', () => ({
  createAnswerWithAnalysis: h.createAnswerWithAnalysis,
  DIAGNOSTIC_TX_OPTIONS: { maxWait: 15_000, timeout: 120_000 },
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: h.ensureKlpsReady }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { startDiagnosticTest, submitDiagnosticTest } from '@/actions/diagnostic'
import { DIAGNOSTIC_BATCH_SIZE, batched } from '@/lib/diagnostic/select'
import { diagnosticOutputCap } from '@/lib/diagnostic/grading'

const OWNER = 'user-owner'
const SET = { id: 'set-1', title: 'M&A basics' }

/** 15 live key points across 5 cards — comfortably over MIN_DIAGNOSTIC_KLPS. */
function liveKlps(count = 15) {
  return Array.from({ length: count }, (_, i) => ({
    id: `klp-${i}`,
    cardId: `card-${i % 5}`,
    index: Math.floor(i / 5),
    text: `Key point ${i}`,
    weight: 5 - (i % 5),
    card: { term: `Term ${i % 5}`, definition: `Definition ${i % 5}` },
  }))
}

/**
 * One generated question per probe, in batches, because the action makes one
 * call per DIAGNOSTIC_BATCH_SIZE probes with refs LOCAL to each batch.
 *
 * A mock that answered the whole run in one response would pass while the real
 * model returns nothing — which is exactly the failure batching exists to fix.
 */
function mockGeneration(probeCount: number) {
  const batches = batched(Array.from({ length: probeCount }, (_, i) => i), DIAGNOSTIC_BATCH_SIZE)
  for (const batch of batches) {
    h.generateJson.mockResolvedValueOnce({
      questions: batch.map((globalRef, probeRef) => ({
        probeRef,
        question: `Question ${globalRef}?`,
        expectedAnswer: `Answer ${globalRef}`,
      })),
    })
  }
  return batches.length
}

function startTx() {
  const diagnosticCreate = vi.fn().mockImplementation(async (args: { data: { questions: { create: unknown[] } } }) => ({
    id: 'attempt-1',
    questions: args.data.questions.create.map((_, position) => ({ id: `question-${position}` })),
  }))
  const quizAttemptCreate = vi.fn().mockResolvedValue({ id: 'quiz-attempt-1' })
  const studySessionCreate = vi.fn().mockResolvedValue({ id: 'session-1' })
  h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    studySession: { create: studySessionCreate },
    quizAttempt: { create: quizAttemptCreate },
    diagnosticAttempt: { create: diagnosticCreate },
  }))
  return { diagnosticCreate, quizAttemptCreate, studySessionCreate }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.setFindFirst.mockResolvedValue(SET)
  h.cardKlpFindMany.mockResolvedValue(liveKlps())
  h.klpStateFindMany.mockResolvedValue([])
  h.cardProgressFindMany.mockResolvedValue([])
  h.quizAttemptFindFirst.mockResolvedValue({ id: 'quiz-attempt-1' })
})

describe('startDiagnosticTest', () => {
  it('anchors every question to a live key point and records it', async () => {
    const tx = startTx()
    mockGeneration(12)

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.questions).toHaveLength(12)

    const created = tx.diagnosticCreate.mock.calls[0][0].data.questions.create
    expect(created).toHaveLength(12)
    for (const question of created) {
      expect(question.klpId).toMatch(/^klp-/)
      // learningPoint is now a denormalised copy of CardKlp.text at ask time,
      // not a phrase the model invented.
      expect(question.learningPoint).toMatch(/^Key point /)
    }
  })

  it('stamps engineVersion 2, so a run is distinguishable from a pre-key-point one', async () => {
    const tx = startTx()
    mockGeneration(12)

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(tx.diagnosticCreate.mock.calls[0][0].data.engineVersion).toBe(2)
  })

  it('creates a QuizAttempt on the SAME StudySession as the DiagnosticAttempt', async () => {
    // Load-bearing for erasure: "forget this set" reaches sessions by setId, so
    // both attempts must hang off one session or one half survives the other.
    const tx = startTx()
    mockGeneration(12)

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(tx.quizAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'diagnostic', sessionId: 'session-1' }),
      }),
    )
    expect(tx.diagnosticCreate.mock.calls[0][0].data.sessionId).toBe('session-1')
  })

  it('never calls ensureKlpsReady — that would fire extraction per card', async () => {
    // Across a 120-card set it is a burst of AI calls the moment somebody
    // presses Start, against a free tier capped at 20 requests/day/model.
    startTx()
    mockGeneration(12)

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(h.ensureKlpsReady).not.toHaveBeenCalled()
  })

  it('reads only live key points', async () => {
    startTx()
    mockGeneration(12)

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(h.cardKlpFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ supersededAt: null }),
      }),
    )
  })

  it('generates in batches rather than one call for the whole run', async () => {
    // Measured on a live model: grading one question costs ~900 reasoning
    // tokens, and a single call for a whole sitting came back with NO output
    // (NoOutputGeneratedError). One call per batch keeps each response inside
    // the budget. A regression to one call passes every mocked assertion and
    // fails against every real model.
    startTx()
    mockGeneration(12)

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(h.generateJson).toHaveBeenCalledTimes(Math.ceil(12 / DIAGNOSTIC_BATCH_SIZE))
  })

  it('asks for an output-token ceiling on every generation call', async () => {
    // Reasoning tokens are invisible until they run out. Without an explicit
    // ceiling a grading call came back finishReason 'length', which the SDK
    // surfaces as NoObjectGeneratedError — classified `schema_invalid`, so it
    // reads as a model that cannot follow a schema rather than one that ran
    // out of room. Batching alone did not fix it: the budget is per call and
    // reasoning varies, so two batches passed and the third did not.
    startTx()
    mockGeneration(12)

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    for (const call of h.generateJson.mock.calls) {
      expect(call[0].maxOutputTokens).toBe(diagnosticOutputCap(DIAGNOSTIC_BATCH_SIZE))
    }
  })

  it('refuses a set below the key-point floor and writes nothing', async () => {
    h.cardKlpFindMany.mockResolvedValue(liveKlps(11))

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/key point/i)
    expect(h.generateJson).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('caps the question count at the number of live key points', async () => {
    const tx = startTx()
    h.cardKlpFindMany.mockResolvedValue(liveKlps(15))
    mockGeneration(15)

    await startDiagnosticTest({ setId: 'set-1', questionCount: 30 })

    expect(tx.diagnosticCreate.mock.calls[0][0].data.questions.create).toHaveLength(15)
  })

  it('rejects a generator response naming an unknown probeRef', async () => {
    startTx()
    h.generateJson.mockResolvedValue({
      questions: [{ probeRef: 99, question: 'q', expectedAnswer: 'a' }],
    })
    // Rejected on the FIRST batch, so nothing is generated and nothing written.

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result.success).toBe(false)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects a generator response missing a probe it was given', async () => {
    startTx()
    mockGeneration(11)

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result.success).toBe(false)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('surfaces the existing structured no-credential error', async () => {
    h.generateJson.mockRejectedValue(new h.AiGenerationError({
      title: 'No AI provider configured',
      why: 'Add a credential in AI settings.',
    }))

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result).toEqual({
      success: false,
      error: 'No AI provider configured',
      detail: { title: 'No AI provider configured', why: 'Add a credential in AI settings.' },
    })
  })
})

const QUESTION_COUNT = 12

function attemptQuestions(overrides: { klpId?: string | null } = {}) {
  return Array.from({ length: QUESTION_COUNT }, (_, position) => ({
    id: `question-${position}`,
    position,
    kind: position < 10 ? 'core' : 'follow-up',
    cardId: `card-${position % 5}`,
    klpId: overrides.klpId === undefined ? `klp-${position}` : overrides.klpId,
    learningPoint: `Key point ${position}`,
    prompt: `Question ${position}?`,
    expectedAnswer: `Answer ${position}`,
  }))
}

function submitTx() {
  const diagnosticQuestionUpdate = vi.fn().mockResolvedValue({})
  h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    diagnosticQuestion: { update: diagnosticQuestionUpdate },
    diagnosticAttempt: { update: vi.fn().mockResolvedValue({}) },
    quizAttempt: { update: vi.fn().mockResolvedValue({}) },
    studySession: { update: vi.fn().mockResolvedValue({}) },
  }))
  return { diagnosticQuestionUpdate }
}

/**
 * Grades in batches with refs LOCAL to each batch, matching the action.
 *
 * The local-ref mapping is the part worth mocking faithfully: a grader that
 * renumbers must not be able to attach one question's verdict to another.
 */
/**
 * An AiGenerationError-shaped failure of a given kind.
 *
 * The shape matters: the retry path reads `detail.attempts[].kind` to decide
 * whether a smaller call could help. A bare Error has no kind and is therefore
 * NOT retryable, which is the correct conservative default.
 */
function aiFailure(kind: string) {
  return Object.assign(new Error(kind), { detail: { attempts: [{ kind }] } })
}

/** One grading response for exactly these question positions, refs local. */
function mockGradingFor(positions: number[], score = 9) {
  h.generateJson.mockResolvedValueOnce({
    grades: positions.map((position, ref) => ({
      questionRef: ref,
      score,
      status: score >= 8 ? 'mastered' : 'partial',
      feedback: `Feedback ${position}`,
      klpResults: [{ klpRef: 0, status: score >= 8 ? 'passed' : 'partial' }],
    })),
  })
}

function mockGrading(options: { withKlpResults?: boolean } = {}) {
  const withKlpResults = options.withKlpResults ?? true
  const batches = batched(
    Array.from({ length: QUESTION_COUNT }, (_, i) => i),
    DIAGNOSTIC_BATCH_SIZE,
  )
  for (const batch of batches) {
    h.generateJson.mockResolvedValueOnce({
      grades: batch.map((position, ref) => ({
        questionRef: ref,
        score: position === 0 ? 4 : 9,
        status: position === 0 ? 'missed' : 'mastered',
        feedback: `Feedback ${position}`,
        mistake: position === 0 ? 'Missed the mechanism.' : undefined,
        ...(withKlpResults
          ? { klpResults: [{ klpRef: 0, status: position === 0 ? 'failed' : 'passed' }] }
          : {}),
      })),
    })
  }
  h.generateJson
    .mockResolvedValueOnce({
      overview: 'One gap surfaced.',
      strengths: ['Most points'],
      gaps: ['Key point 0'],
      recommendations: ['Review key point 0.'],
      learningPoints: [{ text: 'Key point 0', score: 4, evidence: 'Missed the mechanism.', nextAction: 'Retry.' }],
    })
}

describe('submitDiagnosticTest', () => {
  beforeEach(() => {
    h.diagnosticFindFirst.mockResolvedValue({
      id: 'attempt-1',
      userId: OWNER,
      sessionId: 'session-1',
      status: 'in_progress',
      engineVersion: 2,
      set: { title: 'M&A basics' },
      session: { startedAt: new Date(Date.now() - 1000) },
      questions: attemptQuestions(),
    })
    h.cardKlpFindMany.mockResolvedValue(
      Array.from({ length: QUESTION_COUNT }, (_, i) => ({ id: `klp-${i}`, weight: 4 })),
    )
    h.createAnswerWithAnalysis.mockImplementation(async () => ({
      id: `answer-${h.createAnswerWithAnalysis.mock.calls.length - 1}`,
      createdAt: new Date(),
    }))
  })

  it('writes one QuizAnswer per question, in diagnostic mode', async () => {
    submitTx()
    mockGrading()

    const result = await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: `Answer for ${question.id}` })),
    })

    expect(result.success).toBe(true)
    expect(h.createAnswerWithAnalysis).toHaveBeenCalledTimes(QUESTION_COUNT)
    for (const call of h.createAnswerWithAnalysis.mock.calls) {
      expect(call[0].mode).toBe('diagnostic')
      expect(call[0].attemptId).toBe('quiz-attempt-1')
    }
  })

  it('credits only the key point the question asked', async () => {
    // The card has other live key points; the question was anchored to one.
    // Crediting the rest would be a fabricated observation, indistinguishable
    // from a real one once written.
    submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    for (const call of h.createAnswerWithAnalysis.mock.calls) {
      expect(call[1].klpResults).toHaveLength(1)
    }
  })

  it('records no_provenance when the grader returned no key-point verdict', async () => {
    // Not silence. A relational tag table cannot tell "analyzed and clean"
    // from "could not analyze" — both are zero rows.
    submitTx()
    mockGrading({ withKlpResults: false })

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    for (const call of h.createAnswerWithAnalysis.mock.calls) {
      expect(call[1].status).toBe('no_provenance')
      expect(call[1].klpResults).toHaveLength(0)
    }
  })

  it('never passes a replace clause — a diagnostic question is answered once', async () => {
    submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    for (const call of h.createAnswerWithAnalysis.mock.calls) {
      expect(call[2]).toBeUndefined()
    }
  })

  it('links every StudyEvent to its QuizAnswer', async () => {
    // The old path wrote StudyEvent with no quizAnswerId, so erasing the
    // answer left the event behind to disagree about what happened.
    submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    expect(h.recordStudyEvent).toHaveBeenCalledTimes(QUESTION_COUNT)
    for (const call of h.recordStudyEvent.mock.calls) {
      expect(call[0].source).toBe('diagnostic')
      expect(call[0].sessionId).toBe('session-1')
      expect(call[0].quizAnswerId).toMatch(/^answer-/)
    }
  })

  it('links every DiagnosticQuestion back to its QuizAnswer', async () => {
    const tx = submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    expect(tx.diagnosticQuestionUpdate).toHaveBeenCalledTimes(QUESTION_COUNT)
    for (const call of tx.diagnosticQuestionUpdate.mock.calls) {
      expect(call[0].data.quizAnswerId).toMatch(/^answer-/)
    }
  })

  it('still scores the run and returns recommendations', async () => {
    submitTx()
    mockGrading()

    const result = await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.score).toBe(86)
      expect(result.data.report.recommendations).toHaveLength(1)
    }
  })

  it('grades in batches rather than one call for the whole sitting', async () => {
    // Plus one call for the report. Failing at submit is the worst case
    // available — the learner has already answered everything.
    submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    expect(h.generateJson).toHaveBeenCalledTimes(
      Math.ceil(QUESTION_COUNT / DIAGNOSTIC_BATCH_SIZE) + 1,
    )
  })

  it('maps batch-local refs back to the right question', async () => {
    // Refs restart at 0 in every batch. If the mapping used the ref directly
    // instead of the batch offset, question 4 would receive question 0's
    // verdict — silently, and the score would still look plausible.
    const tx = submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    // Only position 0 was graded 'missed'; every other position is 'mastered'.
    const missed = tx.diagnosticQuestionUpdate.mock.calls.filter(
      (call) => call[0].data.status === 'missed',
    )
    expect(missed).toHaveLength(1)
    expect(missed[0][0].where.id).toBe('question-0')
  })

  it('asks for an output-token ceiling on every grading call', async () => {
    submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    const gradingCalls = h.generateJson.mock.calls.slice(0, -1) // last one is the report
    expect(gradingCalls.length).toBeGreaterThan(0)
    for (const call of gradingCalls) {
      // Scaled to the call, so the per-question retry does not hand one
      // question a four-question budget to run away inside.
      expect(call[0].maxOutputTokens).toBe(diagnosticOutputCap(DIAGNOSTIC_BATCH_SIZE))
    }
  })

  it('never sends a blank answer to the grader', async () => {
    // Given an empty answer, gemini-3.6-flash fell into a degenerate repetition
    // loop, spent 15,001 text tokens, hit the output ceiling and returned no
    // parseable object — losing the whole sitting. A blank answer needs no
    // judgment, so it never reaches a model.
    submitTx()
    // 4 answered, 8 blank => 1 grading batch, then the report.
    const answers = attemptQuestions().map((question, i) => ({
      questionId: question.id,
      answer: i < 4 ? 'a real answer' : '   ',
    }))
    mockGradingFor([0, 1, 2, 3])

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(true)
    const gradingCalls = h.generateJson.mock.calls.slice(0, -1)
    expect(gradingCalls).toHaveLength(1)
    for (const call of gradingCalls) {
      expect(call[0].prompt).not.toContain('[no answer]')
    }
  })

  it('grades a blank answer deterministically and still credits the key point', async () => {
    submitTx()
    const answers = attemptQuestions().map((question) => ({ questionId: question.id, answer: '' }))
    // Every answer blank => zero grading calls, only the report.
    h.generateJson.mockResolvedValueOnce({
      overview: 'o', strengths: [], gaps: ['g'], recommendations: ['r'], learningPoints: [],
    })

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(true)
    expect(h.createAnswerWithAnalysis).toHaveBeenCalledTimes(QUESTION_COUNT)
    for (const call of h.createAnswerWithAnalysis.mock.calls) {
      expect(call[1].klpResults).toHaveLength(1)
      expect(call[1].klpResults[0].status).toBe('failed')
      expect(call[1].klpResults[0].credit).toBe(0)
    }
  })

  it('retries a failed batch one question at a time', async () => {
    // A single unusable response must cost one question, not the sitting.
    submitTx()
    const answers = attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' }))
    // Batch 1 fails; its four questions then succeed individually. Batches 2
    // and 3 succeed outright.
    h.generateJson.mockRejectedValueOnce(aiFailure('schema_invalid'))
    for (let i = 0; i < 4; i++) {
      h.generateJson.mockResolvedValueOnce({
        grades: [{ questionRef: 0, score: 7, status: 'partial', feedback: 'f',
          klpResults: [{ klpRef: 0, status: 'partial' }] }],
      })
    }
    mockGradingFor([4, 5, 6, 7])
    mockGradingFor([8, 9, 10, 11])
    h.generateJson.mockResolvedValueOnce({
      overview: 'o', strengths: [], gaps: ['g'], recommendations: ['r'], learningPoints: [],
    })

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(true)
    expect(h.createAnswerWithAnalysis).toHaveBeenCalledTimes(QUESTION_COUNT)
  })

  it('records a question that fails even alone as ungraded, and keeps the rest', async () => {
    submitTx()
    const answers = attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' }))
    // Batch 1 fails, and so does every one of its four retries.
    h.generateJson.mockRejectedValueOnce(aiFailure('schema_invalid'))
    for (let i = 0; i < 4; i++) h.generateJson.mockRejectedValueOnce(aiFailure('schema_invalid'))
    mockGradingFor([4, 5, 6, 7])
    mockGradingFor([8, 9, 10, 11])
    h.generateJson.mockResolvedValueOnce({
      overview: 'o', strengths: [], gaps: ['g'], recommendations: ['r'], learningPoints: [],
    })

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(true)
    // All twelve raw records are written; the four ungraded ones carry 'failed'
    // rather than zero rows, which cannot be told apart from a clean answer.
    expect(h.createAnswerWithAnalysis).toHaveBeenCalledTimes(QUESTION_COUNT)
    const failed = h.createAnswerWithAnalysis.mock.calls.filter((c) => c[1].status === 'failed')
    expect(failed).toHaveLength(4)
    for (const call of failed) expect(call[1].klpResults).toHaveLength(0)
    // And no StudyEvent for them — confidence must not move on evidence that
    // does not exist.
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(QUESTION_COUNT - 4)
  })

  it('excludes ungraded questions from the score rather than counting them zero', async () => {
    submitTx()
    const answers = attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' }))
    h.generateJson.mockRejectedValueOnce(aiFailure('schema_invalid'))
    for (let i = 0; i < 4; i++) h.generateJson.mockRejectedValueOnce(aiFailure('schema_invalid'))
    // The eight that DO grade all score 9.
    mockGradingFor([4, 5, 6, 7], 9)
    mockGradingFor([8, 9, 10, 11], 9)
    h.generateJson.mockResolvedValueOnce({
      overview: 'o', strengths: [], gaps: [], recommendations: ['r'], learningPoints: [],
    })

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(true)
    // 90, not 60. Scoring a model failure as a miss reports it as the
    // learner's failure — the most misleading thing this could do.
    if (result.success) expect(result.data.score).toBe(90)
  })

  it('aborts on an exhausted quota instead of burning per-question retries', async () => {
    // A quota failure is transient and total: retrying four questions
    // individually is four guaranteed failures against an empty budget, and
    // would mark them permanently ungraded for a problem that resets overnight.
    // One call, then stop — and nothing written, so the same answers can be
    // submitted again later.
    submitTx()
    const answers = attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' }))
    const quotaError = Object.assign(new Error('quota'), {
      detail: { attempts: [{ kind: 'quota_exhausted' }, { kind: 'quota_exhausted' }] },
    })
    h.generateJson.mockRejectedValue(quotaError)

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/quota|try submitting again/i)
    expect(h.generateJson).toHaveBeenCalledTimes(1)
    expect(h.createAnswerWithAnalysis).not.toHaveBeenCalled()
  })

  it('still retries per question when the failure is an unparseable response', async () => {
    // The contrast with the test above: schema_invalid IS fixed by asking for
    // less, so it earns the retry that quota does not.
    submitTx()
    const answers = attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' }))
    h.generateJson.mockRejectedValueOnce(aiFailure('schema_invalid'))
    for (let i = 0; i < 4; i++) {
      h.generateJson.mockResolvedValueOnce({
        grades: [{ questionRef: 0, score: 7, status: 'partial', feedback: 'f',
          klpResults: [{ klpRef: 0, status: 'partial' }] }],
      })
    }
    mockGradingFor([4, 5, 6, 7])
    mockGradingFor([8, 9, 10, 11])
    h.generateJson.mockResolvedValueOnce({
      overview: 'o', strengths: [], gaps: [], recommendations: ['r'], learningPoints: [],
    })

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(true)
    expect(h.createAnswerWithAnalysis).toHaveBeenCalledTimes(QUESTION_COUNT)
  })

  it('fails the submission only when NOTHING could be graded', async () => {
    submitTx()
    const answers = attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' }))
    h.generateJson.mockRejectedValue(aiFailure('schema_invalid'))

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers })

    expect(result.success).toBe(false)
    expect(h.createAnswerWithAnalysis).not.toHaveBeenCalled()
  })

  it('rejects an incomplete grade set and persists nothing', async () => {
    submitTx()
    h.generateJson.mockResolvedValueOnce({
      grades: [{ questionRef: 0, score: 5, status: 'partial', feedback: 'f' }],
    })

    const result = await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    expect(result.success).toBe(false)
    expect(h.createAnswerWithAnalysis).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('refuses an attempt that is not in progress', async () => {
    h.diagnosticFindFirst.mockResolvedValue({
      id: 'attempt-1', userId: OWNER, sessionId: 'session-1', status: 'abandoned',
      engineVersion: 1, set: { title: 'x' }, session: { startedAt: new Date() },
      questions: attemptQuestions(),
    })

    const result = await submitDiagnosticTest({ attemptId: 'attempt-1', answers: [] })

    expect(result.success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('refuses when the sibling QuizAttempt is missing rather than writing half a sitting', async () => {
    h.quizAttemptFindFirst.mockResolvedValue(null)

    const result = await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    expect(result.success).toBe(false)
    expect(h.createAnswerWithAnalysis).not.toHaveBeenCalled()
  })

  it('records no_klps, not a fabricated verdict, when a question lost its anchor', async () => {
    // klpId is SetNull, so a removed key point leaves the question standing
    // and unattributed. It must still record the answer.
    h.diagnosticFindFirst.mockResolvedValue({
      id: 'attempt-1', userId: OWNER, sessionId: 'session-1', status: 'in_progress',
      engineVersion: 2, set: { title: 'x' }, session: { startedAt: new Date(Date.now() - 1000) },
      questions: attemptQuestions({ klpId: null }),
    })
    h.cardKlpFindMany.mockResolvedValue([])
    submitTx()
    mockGrading()

    await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x' })),
    })

    expect(h.createAnswerWithAnalysis).toHaveBeenCalledTimes(QUESTION_COUNT)
    for (const call of h.createAnswerWithAnalysis.mock.calls) {
      expect(call[1].status).toBe('no_klps')
      expect(call[1].klpResults).toHaveLength(0)
    }
  })
})
