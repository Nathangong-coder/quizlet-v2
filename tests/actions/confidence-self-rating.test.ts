import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spec 6 §3.2: recordReview forwards the prospective rating with moment
// `before_answer`. The gate is recordStudyEvent's (mocked here).
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  recordStudyEvent: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))

import { recordReview } from '@/actions/confidence'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: null, dueAt: new Date() })
})

describe('recordReview forwards the self-rating', () => {
  it('passes selfRating with moment before_answer', async () => {
    await recordReview('c1', true, { sessionId: 's1', latencyMs: 900, selfRating: 2 })
    expect(h.recordStudyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'review',
        sessionId: 's1',
        outcome: { correct: true },
        meta: { latencyMs: 900, selfRating: 2, selfRatingMoment: 'before_answer' },
      }),
    )
  })

  it('without a rating the moment still rides and the rating is undefined', async () => {
    await recordReview('c1', false, { latencyMs: 100 })
    const meta = h.recordStudyEvent.mock.calls[0][0].meta
    expect(meta.selfRating).toBeUndefined()
    expect(meta.selfRatingMoment).toBe('before_answer')
  })
})
