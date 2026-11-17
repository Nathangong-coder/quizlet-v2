import { beforeEach, describe, expect, it, vi } from 'vitest'

// Spec 6 §3.3: the diagnostic forwards each answer's self-rating into
// recordStudyEvent with the retrospective moment. Harness is a compact copy of
// tests/actions/diagnostic.test.ts's submit setup; only the forwarding is
// asserted here.
const h = vi.hoisted(() => ({
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
}))

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
  generateJsonWithMeta: async (...args: unknown[]) => ({
    value: await h.generateJson(...args),
    meta: { model: 'test-model', provider: 'google', credentialId: 'cred-1' },
  }),
  AiGenerationError: class extends Error {
    detail: unknown
    constructor(detail: { title: string }) {
      super(detail.title)
      this.detail = detail
    }
  },
}))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))
vi.mock('@/lib/analysis/write-answer', () => ({
  createAnswerWithAnalysis: h.createAnswerWithAnalysis,
  DIAGNOSTIC_TX_OPTIONS: { maxWait: 15_000, timeout: 120_000 },
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: h.ensureKlpsReady }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { submitDiagnosticTest } from '@/actions/diagnostic'
import { DIAGNOSTIC_BATCH_SIZE, batched } from '@/lib/diagnostic/select'

const OWNER = 'user-owner'
const QUESTION_COUNT = 12

function attemptQuestions() {
  return Array.from({ length: QUESTION_COUNT }, (_, position) => ({
    id: `question-${position}`,
    position,
    kind: position < 10 ? 'core' : 'follow-up',
    cardId: `card-${position % 5}`,
    klpId: `klp-${position}`,
    learningPoint: `Key point ${position}`,
    prompt: `Question ${position}?`,
    expectedAnswer: `Answer ${position}`,
  }))
}

function submitTx() {
  h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      diagnosticQuestion: { update: vi.fn().mockResolvedValue({}) },
      diagnosticAttempt: { update: vi.fn().mockResolvedValue({}) },
      quizAttempt: { update: vi.fn().mockResolvedValue({}) },
      studySession: { update: vi.fn().mockResolvedValue({}) },
    }),
  )
}

/** Every question graded 9, in batches with refs local to each batch. */
function mockGrading() {
  const batches = batched(
    Array.from({ length: QUESTION_COUNT }, (_, i) => i),
    DIAGNOSTIC_BATCH_SIZE,
  )
  for (const batch of batches) {
    h.generateJson.mockResolvedValueOnce({
      grades: batch.map((position, ref) => ({
        questionRef: ref,
        score: 9,
        status: 'mastered',
        feedback: `Feedback ${position}`,
        klpResults: [{ klpRef: 0, status: 'correct' }],
      })),
    })
  }
  h.generateJson.mockResolvedValueOnce({
    overview: 'Fine.',
    strengths: ['Most points'],
    gaps: [],
    recommendations: [],
    learningPoints: [],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.setFindFirst.mockResolvedValue({ id: 'set-1', title: 'M&A basics' })
  h.klpStateFindMany.mockResolvedValue([])
  h.cardProgressFindMany.mockResolvedValue([])
  h.quizAttemptFindFirst.mockResolvedValue({ id: 'quiz-attempt-1' })
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
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
})

describe('submitDiagnosticTest forwards the self-rating (Spec 6 §3.3)', () => {
  it('passes each answer’s selfRating with moment after_answer, undefined when skipped', async () => {
    submitTx()
    mockGrading()

    const result = await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question, i) => ({
        questionId: question.id,
        answer: 'x',
        latencyMs: 1000 + i,
        // Rate every other question; the rest are skips (undefined).
        selfRating: i % 2 === 0 ? (i % 4) + 1 : undefined,
      })),
    })
    expect(result.success).toBe(true)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(QUESTION_COUNT)

    for (const [call] of h.recordStudyEvent.mock.calls) {
      expect(call.meta.selfRatingMoment).toBe('after_answer')
    }
    // Latency is unique per question, so it identifies the row.
    const byLatency = new Map(
      h.recordStudyEvent.mock.calls.map(([c]) => [c.meta.latencyMs as number, c.meta]),
    )
    expect(byLatency.get(1000)?.selfRating).toBe(1)
    expect(byLatency.get(1001)?.selfRating).toBeUndefined()
    expect(byLatency.get(1002)?.selfRating).toBe(3)
    expect(byLatency.get(1004)?.selfRating).toBe(1)
    expect(byLatency.get(1006)?.selfRating).toBe(3)
  })

  it('rejects an out-of-vocabulary rating at the schema (5, 0, 2.5) before any grading', async () => {
    submitTx()
    for (const bad of [5, 0, 2.5]) {
      mockGrading()
      const result = await submitDiagnosticTest({
        attemptId: 'attempt-1',
        answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x', selfRating: bad })),
      })
      expect(result.success, String(bad)).toBe(false)
      // Refused at input validation: the grader was never called.
      expect(h.generateJson, String(bad)).not.toHaveBeenCalled()
      h.generateJson.mockReset()
    }
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('MUTATION CHECK: the same submission with a valid rating is graded', async () => {
    submitTx()
    mockGrading()
    const result = await submitDiagnosticTest({
      attemptId: 'attempt-1',
      answers: attemptQuestions().map((question) => ({ questionId: question.id, answer: 'x', selfRating: 4 })),
    })
    expect(result.success).toBe(true)
    expect(h.generateJson).toHaveBeenCalled()
  })
})
