import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    set: { findMany: vi.fn(), findFirst: vi.fn() },
    cardKlp: { findMany: vi.fn() },
    klpState: { findMany: vi.fn() },
    cardProgress: { findMany: vi.fn() },
    quizAttempt: { findFirst: vi.fn() },
    diagnosticAttempt: { findMany: h.findMany, findFirst: h.findFirst },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/ai/generate', () => ({ generateJson: vi.fn(), AiGenerationError: class extends Error {} }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: vi.fn() }))
vi.mock('@/lib/analysis/write-answer', () => ({
  createAnswerWithAnalysis: vi.fn(),
  DIAGNOSTIC_TX_OPTIONS: { maxWait: 1, timeout: 1 },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getDiagnosticHistory, getDiagnosticAttempt } from '@/actions/diagnostic'

const OWNER = 'user-owner'

const REPORT = {
  overview: 'o',
  strengths: ['s'],
  gaps: ['g'],
  recommendations: ['r'],
  learningPoints: [{ text: 't', score: 5, evidence: 'e', nextAction: 'n' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
})

describe('getDiagnosticHistory', () => {
  it('lists only the signed-in user\'s completed attempts, newest first', async () => {
    // Owner-scoped like quiz attempts, NOT open-by-id like sets: a diagnostic
    // is what somebody did not know, in their own words.
    //
    // Completed only — an abandoned or in-flight attempt is not a result, and
    // listing one offers a link to a page with nothing to render.
    h.findMany.mockResolvedValue([])

    await getDiagnosticHistory()

    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: OWNER, status: 'completed' },
        orderBy: { completedAt: 'desc' },
      }),
    )
  })

  it('carries engineVersion through so a pre-key-point run can be labelled', async () => {
    h.findMany.mockResolvedValue([{
      id: 'a1',
      score: 75,
      questionCount: 12,
      engineVersion: 1,
      completedAt: new Date('2026-09-01'),
      createdAt: new Date('2026-09-01'),
      set: { title: 'Accounting' },
    }])

    const result = await getDiagnosticHistory()

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data[0].engineVersion).toBe(1)
      expect(result.data[0].setTitle).toBe('Accounting')
    }
  })

  it('refuses an anonymous caller', async () => {
    h.auth.mockResolvedValue(null)
    const result = await getDiagnosticHistory()
    expect(result.success).toBe(false)
    expect(h.findMany).not.toHaveBeenCalled()
  })
})

describe('getDiagnosticAttempt', () => {
  it('scopes to the owner in the where clause, not in a check afterwards', async () => {
    // A forgotten comparison returns somebody else's answers; a forgotten
    // where clause returns nothing.
    h.findFirst.mockResolvedValue(null)

    await getDiagnosticAttempt('a1')

    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', userId: OWNER, status: 'completed' },
      }),
    )
  })

  it('returns a failure for an attempt that is not the caller\'s', async () => {
    h.findFirst.mockResolvedValue(null)
    const result = await getDiagnosticAttempt('someone-elses')
    expect(result.success).toBe(false)
  })

  it('reads back a completed attempt with its engineVersion', async () => {
    h.findFirst.mockResolvedValue({
      id: 'a1',
      score: 75,
      engineVersion: 1,
      report: REPORT,
      set: { title: 'Accounting' },
      questions: [{
        id: 'q1', position: 0, kind: 'core', prompt: 'p', learningPoint: 'lp',
        answer: 'a', score: 7, status: 'partial', feedback: 'f', mistake: null,
      }],
    })

    const result = await getDiagnosticAttempt('a1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.engineVersion).toBe(1)
      expect(result.data.score).toBe(75)
      expect(result.data.questions).toHaveLength(1)
    }
  })

  it('refuses rather than rendering a report it cannot parse', async () => {
    h.findFirst.mockResolvedValue({
      id: 'a1', score: 75, engineVersion: 2, report: { nonsense: true },
      set: { title: 'x' }, questions: [],
    })

    const result = await getDiagnosticAttempt('a1')
    expect(result.success).toBe(false)
  })
})
