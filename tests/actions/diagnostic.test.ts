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
vi.mock('@/lib/ai/generate', () => ({ generateJson: h.generateJson, AiGenerationError: h.AiGenerationError }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))
vi.mock('@/lib/analysis/write-answer', () => ({
  createAnswerWithAnalysis: h.createAnswerWithAnalysis,
  DIAGNOSTIC_TX_OPTIONS: { maxWait: 15_000, timeout: 120_000 },
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: h.ensureKlpsReady }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { startDiagnosticTest, submitDiagnosticTest } from '@/actions/diagnostic'

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

/** One generated question per probe, keyed by probeRef. */
function generatedFor(probeCount: number) {
  return {
    questions: Array.from({ length: probeCount }, (_, probeRef) => ({
      probeRef,
      question: `Question ${probeRef}?`,
      expectedAnswer: `Answer ${probeRef}`,
    })),
  }
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
    h.generateJson.mockResolvedValue(generatedFor(12))

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
    h.generateJson.mockResolvedValue(generatedFor(12))

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(tx.diagnosticCreate.mock.calls[0][0].data.engineVersion).toBe(2)
  })

  it('creates a QuizAttempt on the SAME StudySession as the DiagnosticAttempt', async () => {
    // Load-bearing for erasure: "forget this set" reaches sessions by setId, so
    // both attempts must hang off one session or one half survives the other.
    const tx = startTx()
    h.generateJson.mockResolvedValue(generatedFor(12))

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
    h.generateJson.mockResolvedValue(generatedFor(12))

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(h.ensureKlpsReady).not.toHaveBeenCalled()
  })

  it('reads only live key points', async () => {
    startTx()
    h.generateJson.mockResolvedValue(generatedFor(12))

    await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(h.cardKlpFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ supersededAt: null }),
      }),
    )
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
    h.generateJson.mockImplementation(async () => generatedFor(15))

    await startDiagnosticTest({ setId: 'set-1', questionCount: 30 })

    expect(tx.diagnosticCreate.mock.calls[0][0].data.questions.create).toHaveLength(15)
  })

  it('rejects a generator response naming an unknown probeRef', async () => {
    startTx()
    h.generateJson.mockResolvedValue({
      questions: [{ probeRef: 99, question: 'q', expectedAnswer: 'a' }],
    })

    const result = await startDiagnosticTest({ setId: 'set-1', questionCount: 12 })

    expect(result.success).toBe(false)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects a generator response missing a probe it was given', async () => {
    startTx()
    h.generateJson.mockResolvedValue(generatedFor(11))

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

function mockGrading(options: { withKlpResults?: boolean } = {}) {
  const withKlpResults = options.withKlpResults ?? true
  h.generateJson
    .mockResolvedValueOnce({
      grades: Array.from({ length: QUESTION_COUNT }, (_, position) => ({
        questionRef: position,
        score: position === 0 ? 4 : 9,
        status: position === 0 ? 'missed' : 'mastered',
        feedback: `Feedback ${position}`,
        mistake: position === 0 ? 'Missed the mechanism.' : undefined,
        ...(withKlpResults
          ? { klpResults: [{ klpRef: 0, status: position === 0 ? 'failed' : 'passed' }] }
          : {}),
      })),
    })
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
