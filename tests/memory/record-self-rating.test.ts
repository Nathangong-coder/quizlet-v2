import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spec 6 §2: recordStudyEvent is the gate. The server, not the client, decides
// whether a rating is kept — a stale tab cannot write a rating against a
// setting the learner just turned off, and a malformed value is dropped.

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  create: vi.fn(),
  tuningFindUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        cardProgress: { findUnique: h.findUnique, upsert: h.upsert },
        studyEvent: { findMany: h.findMany, create: h.create },
        learnerTuning: { findUnique: h.tuningFindUnique },
      }),
  },
}))

import { recordStudyEvent } from '@/lib/memory/record'

const base = {
  userId: 'u1',
  cardId: 'c1',
  source: 'quiz-mc' as const,
  outcome: { correct: true },
}

function created() {
  return h.create.mock.calls.at(-1)![0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findUnique.mockResolvedValue({ confidence: 5, reps: 0 })
  h.findMany.mockResolvedValue([])
  h.upsert.mockResolvedValue({})
  h.create.mockResolvedValue({})
  h.tuningFindUnique.mockResolvedValue({ captureSelfRating: true })
})

describe('recordStudyEvent self-rating gate', () => {
  it('toggle off ⇒ both NULL even when a rating was passed', async () => {
    h.tuningFindUnique.mockResolvedValue({ captureSelfRating: false })
    await recordStudyEvent({ ...base, meta: { selfRating: 3, selfRatingMoment: 'after_answer' } })
    expect(created().selfRating).toBeNull()
    expect(created().selfRatingMoment).toBeNull()
  })

  it('MUTATION CHECK: the same input with the toggle on writes 3', async () => {
    h.tuningFindUnique.mockResolvedValue({ captureSelfRating: true })
    await recordStudyEvent({ ...base, meta: { selfRating: 3, selfRatingMoment: 'after_answer' } })
    expect(created().selfRating).toBe(3)
    expect(created().selfRatingMoment).toBe('after_answer')
  })

  it('reads the toggle by the user primary key, inside the transaction', async () => {
    await recordStudyEvent({ ...base, meta: { selfRating: 2, selfRatingMoment: 'before_answer' } })
    expect(h.tuningFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
  })

  it('rating without moment, moment without rating, bad rating, bad moment ⇒ NULL, NULL', async () => {
    const cases = [
      { selfRating: 3 },
      { selfRatingMoment: 'after_answer' },
      { selfRating: 7, selfRatingMoment: 'after_answer' },
      { selfRating: 0, selfRatingMoment: 'after_answer' },
      { selfRating: 2.5, selfRatingMoment: 'after_answer' },
      { selfRating: 2, selfRatingMoment: 'later' },
    ]
    for (const meta of cases) {
      await recordStudyEvent({ ...base, meta })
      expect(created().selfRating, JSON.stringify(meta)).toBeNull()
      expect(created().selfRatingMoment, JSON.stringify(meta)).toBeNull()
    }
  })

  it('no LearnerTuning row ⇒ treated as on', async () => {
    h.tuningFindUnique.mockResolvedValue(null)
    await recordStudyEvent({ ...base, meta: { selfRating: 1, selfRatingMoment: 'before_answer' } })
    expect(created().selfRating).toBe(1)
    expect(created().selfRatingMoment).toBe('before_answer')
  })

  it('no meta ⇒ NULL, NULL and the event still writes', async () => {
    await recordStudyEvent({ ...base })
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(created().selfRating).toBeNull()
    expect(created().selfRatingMoment).toBeNull()
  })

  it('a rating never touches confidence, mastery or scheduling', async () => {
    const without = await recordStudyEvent({ ...base, meta: { latencyMs: 1000 } })
    const withRating = await recordStudyEvent({
      ...base,
      meta: { latencyMs: 1000, selfRating: 4, selfRatingMoment: 'after_answer' },
    })
    expect(withRating.confidence).toBe(without.confidence)
    expect(withRating.mastery).toBe(without.mastery)
    expect(created().latencyMs).toBe(1000)
  })
})
