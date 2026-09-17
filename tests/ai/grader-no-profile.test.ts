import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Spec 5, "The boundary": the grader is a stateless instrument. It answers
 * "what does this answer contain?", never "what does this person know?" —
 * so the grading prompt module must not be able to see the learner at all.
 * A source scan, because a `profileBlock` field that is merely unused today
 * is one refactor away from being wired back in.
 *
 * The companion assertion — that `submitShortAnswer` never fetches a profile
 * block — lands with Task 8, which removes that fetch from the action.
 */
describe('the grader never sees the learner', () => {
  it('the grading prompt module never imports learner context', () => {
    const src = readFileSync(join(__dirname, '../../src/lib/ai/prompts/grade-short-answer.ts'), 'utf-8')
    expect(src).not.toMatch(/learnerContextBlock|profileBlock/)
  })
})
