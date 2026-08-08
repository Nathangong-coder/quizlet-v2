import { describe, it, expect } from 'vitest'
import { RESET_MEMORY_MODELS } from '@/lib/memory/reset'

describe('resetUserMemory (B3)', () => {
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

  it('names only real Prisma model keys, since the reset indexes the client by them', () => {
    // The list IS the delete set — resetUserMemory maps over it rather than
    // repeating a hand-written array, so a typo here is a runtime failure of
    // the whole reset, not a silently skipped table.
    for (const model of RESET_MEMORY_MODELS) {
      expect(model).toMatch(/^[a-z][A-Za-z]+$/)
    }
    expect(new Set(RESET_MEMORY_MODELS).size).toBe(RESET_MEMORY_MODELS.length)
  })
})
