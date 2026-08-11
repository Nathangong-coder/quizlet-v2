import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RESET_MEMORY_MODELS } from '@/lib/memory/reset'

const h = vi.hoisted(() => ({ auth: vi.fn(), executeErasure: vi.fn() }))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/memory/erase-execute', () => ({ executeErasure: h.executeErasure }))

import { resetUserMemory } from '@/actions/user'

describe('RESET_MEMORY_MODELS (B3)', () => {
  // NOTE: this list is no longer the delete set. `resetUserMemory` routes
  // through the erasure module, which truncates ERASABLE_MEMORY_MODELS —
  // this list spread plus `studySession`. These assertions survive because
  // that constant is built FROM this one, so a regression here still reaches
  // the reset; see tests/memory/erase-coverage.test.ts for the link itself.

  it('clears the knowledge posterior, not only the evidence behind it', () => {
    // KlpState is an incremental posterior and is not self-correcting: leaving
    // it behind means "reset my memory" silently preserves every knowledge
    // estimate. Worse, it is then unrepairable — the backfill rebuilds state
    // FROM AnswerKlpResult rows, so a KLP whose rows were all just deleted
    // produces no replayed state and is never upserted back down to the prior.
    // The stale row simply survives every subsequent repair.
    expect(RESET_MEMORY_MODELS).toContain('klpState')
  })

  it('still clears the evidence tables it always cleared', () => {
    expect(RESET_MEMORY_MODELS).toEqual(
      expect.arrayContaining([
        'quizAttempt',
        'quizAnswer',
        'confidenceEvent',
        'cardProgress',
        'studyEvent',
      ]),
    )
  })

  it('deletes attempts before answers, so the cascade cannot orphan a row', () => {
    // QuizAttempt cascades to QuizAnswer, which cascades to AnswerKlpResult.
    // The explicit quizAnswer delete stays because an answer may outlive its
    // attempt; it must run after so it only sweeps up what the cascade missed.
    const models: readonly string[] = RESET_MEMORY_MODELS
    expect(models.indexOf('quizAttempt')).toBeLessThan(models.indexOf('quizAnswer'))
  })

  it('names only real Prisma model keys, since the erasure indexes the client by them', () => {
    // `eraseAccount` keys a Record on this union and indexes it per model, so
    // a typo here is a runtime failure of the whole reset, not a silently
    // skipped table.
    for (const model of RESET_MEMORY_MODELS) {
      expect(model).toMatch(/^[a-z][A-Za-z]+$/)
    }
    expect(new Set(RESET_MEMORY_MODELS).size).toBe(RESET_MEMORY_MODELS.length)
  })
})

describe('resetUserMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.executeErasure.mockResolvedValue(undefined)
  })

  it('delegates to the erasure module rather than deleting by hand', async () => {
    // The hand-written transaction is what let the account reset omit
    // studySession (and, once before, klpState). One module, one answer to
    // "what counts as memory".
    const result = await resetUserMemory()
    expect(result.success).toBe(true)
    expect(h.executeErasure).toHaveBeenCalledWith('u1', { kind: 'account' })
  })

  it('rejects a signed-out caller without erasing anything', async () => {
    h.auth.mockResolvedValue(null)
    const result = await resetUserMemory()
    expect(result).toEqual({ success: false, error: 'Unauthorized' })
    expect(h.executeErasure).not.toHaveBeenCalled()
  })

  it('reports a failure rather than throwing', async () => {
    h.executeErasure.mockRejectedValue(new Error('boom'))
    const result = await resetUserMemory()
    expect(result).toEqual({ success: false, error: 'Failed to reset memory' })
  })
})
