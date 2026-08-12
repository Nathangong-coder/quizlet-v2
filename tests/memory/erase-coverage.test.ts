import { describe, it, expect } from 'vitest'
import { RESET_MEMORY_MODELS } from '@/lib/memory/reset'
import { ERASABLE_MEMORY_MODELS } from '@/lib/memory/erase'

describe('ERASABLE_MEMORY_MODELS', () => {
  it('covers every model the legacy reset list names', () => {
    // Adding a memory model without teaching erasure about it must fail here
    // rather than leave rows standing after a reset.
    for (const model of RESET_MEMORY_MODELS) {
      expect(ERASABLE_MEMORY_MODELS).toContain(model)
    }
  })

  it('adds studySession, which RESET_MEMORY_MODELS omits', () => {
    // Both StudyEvent.sessionId and QuizAttempt.sessionId are onDelete: SetNull,
    // so a full reset used to leave every session row standing as an empty husk.
    expect(RESET_MEMORY_MODELS).not.toContain('studySession')
    expect(ERASABLE_MEMORY_MODELS).toContain('studySession')
  })

  it('keeps attempts ahead of answers in the list eraseAccount actually iterates', () => {
    // The cascade ordering that user-reset.test.ts pins on RESET_MEMORY_MODELS
    // is only load-bearing because `eraseAccount` iterates THIS list. It holds
    // today by construction (spread + append), but a future edit that reorders
    // the spread or inserts ahead of it would break the cascade with every
    // legacy assertion still green.
    const models: readonly string[] = ERASABLE_MEMORY_MODELS
    expect(models.indexOf('quizAttempt')).toBeLessThan(models.indexOf('quizAnswer'))
  })
})
