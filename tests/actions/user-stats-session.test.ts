import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindMany: vi.fn(),
  progressFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findMany: h.attemptFindMany },
    cardProgress: { findMany: h.progressFindMany },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getUserStats } from '@/actions/user'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.progressFindMany.mockResolvedValue([])
})

describe('getUserStats', () => {
  it("returns each attempt's sessionId so the activity permalink is reachable", async () => {
    // The permalink is keyed on the SESSION, not the attempt.
    h.attemptFindMany.mockResolvedValue([
      {
        id: 'att1',
        mode: 'multiple-choice',
        score: 80,
        createdAt: new Date(),
        sessionId: 's1',
        set: { id: 'set1', title: 'S' },
      },
    ])
    const res = await getUserStats()
    expect(res.data!.recentAttempts[0].sessionId).toBe('s1')
  })

  it('surfaces a null sessionId for a pre-Stage-6 attempt', async () => {
    // Those attempts have no session and must render unlinked, not crash.
    h.attemptFindMany.mockResolvedValue([
      {
        id: 'att1',
        mode: 'multiple-choice',
        score: 80,
        createdAt: new Date(),
        sessionId: null,
        set: { id: 'set1', title: 'S' },
      },
    ])
    const res = await getUserStats()
    expect(res.data!.recentAttempts[0].sessionId).toBeNull()
  })
})
