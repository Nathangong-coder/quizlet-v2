import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), executeErasure: vi.fn() }))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/memory/erase-execute', () => ({ executeErasure: h.executeErasure }))

import {
  deleteStudyEvent,
  forgetCard,
  forgetSet,
  resetQuizAttempt,
  resetQuizAnswer,
} from '@/actions/memory'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.executeErasure.mockResolvedValue(undefined)
})

describe('the memory erasure actions', () => {
  it.each([
    ['deleteStudyEvent', () => deleteStudyEvent('e1'), { kind: 'event', eventId: 'e1' }],
    ['forgetCard', () => forgetCard('c1'), { kind: 'card', cardId: 'c1' }],
    ['forgetSet', () => forgetSet('s1'), { kind: 'set', setId: 's1' }],
    ['resetQuizAttempt', () => resetQuizAttempt('att1'), { kind: 'attempt', attemptId: 'att1' }],
    ['resetQuizAnswer', () => resetQuizAnswer('a1'), { kind: 'answer', answerId: 'a1' }],
  ])('%s delegates to executeErasure with its scope', async (_name, call, scope) => {
    // Every verb goes through the one module. Five hand-written copies of
    // "delete then replay" is what let resetUserMemory forget KlpState once.
    const result = await call()
    expect(result.success).toBe(true)
    expect(h.executeErasure).toHaveBeenCalledWith('u1', scope)
  })

  it('rejects a signed-out caller without erasing anything', async () => {
    h.auth.mockResolvedValue(null)
    const result = await forgetCard('c1')
    expect(result).toEqual({ success: false, error: 'Unauthorized' })
    expect(h.executeErasure).not.toHaveBeenCalled()
  })

  it('reports a failure rather than throwing', async () => {
    h.executeErasure.mockRejectedValue(new Error('Not found'))
    const result = await resetQuizAttempt('att1')
    expect(result.success).toBe(false)
    // The verb's own copy, not the thrown message. executeErasure throws a bare
    // 'Not found' for both absent and not-yours, which tells a learner nothing
    // and tells a prober whether the id exists.
    expect(result).toEqual({ success: false, error: 'Failed to reset this quiz' })
  })
})
