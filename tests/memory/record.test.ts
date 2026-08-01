import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        cardProgress: { findUnique: h.findUnique, upsert: h.upsert },
        studyEvent: { findMany: h.findMany, create: h.create },
      }),
  },
}))

import { recordStudyEvent } from '@/lib/memory/record'

beforeEach(() => {
  vi.clearAllMocks()
  h.findUnique.mockResolvedValue({ confidence: 5, reps: 0 })
  h.findMany.mockResolvedValue([])
  h.upsert.mockResolvedValue({})
  h.create.mockResolvedValue({})
})

describe('recordStudyEvent session/latency plumbing', () => {
  it('persists sessionId, confidenceBefore, and a normalized latency', async () => {
    await recordStudyEvent({
      userId: 'u1',
      cardId: 'c1',
      source: 'quiz-mc',
      outcome: { correct: true },
      sessionId: 's1',
      meta: { latencyMs: 4200.7 },
    })

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 's1',
          confidenceBefore: 5,
          confidenceAfter: 6,
          latencyMs: 4201,
        }),
      }),
    )
  })

  it('stores an implausible latency as null rather than as a real duration', async () => {
    await recordStudyEvent({
      userId: 'u1',
      cardId: 'c1',
      source: 'review',
      outcome: { correct: false },
      meta: { latencyMs: 45 * 60 * 1000 },
    })

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latencyMs: null, sessionId: undefined }),
      }),
    )
  })
})
