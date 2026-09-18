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
 * The companion assertion below is on the ACTION: `submitShortAnswer` never
 * fetches a profile block either. `safeProfileBlock` legitimately survives
 * elsewhere in the same file (MC distractor GENERATION at
 * `getOrGenerateMultipleChoiceOptions` — steering what to ask is a
 * different job from judging what was answered), so the scan is scoped to
 * the grading action's body, not the module.
 */
describe('the grader never sees the learner', () => {
  it('the grading prompt module never imports learner context', () => {
    const src = readFileSync(join(__dirname, '../../src/lib/ai/prompts/grade-short-answer.ts'), 'utf-8')
    expect(src).not.toMatch(/learnerContextBlock|profileBlock/)
  })

  it('the annotation prompt module never imports learner context either', () => {
    // Annotations are the second AI call of the same grading action. A
    // `profileBlock` field left on its input type is one refactor away from
    // being wired back in — the boundary is closed by TYPE, not only by scan.
    const src = readFileSync(join(__dirname, '../../src/lib/ai/prompts/annotation.ts'), 'utf-8')
    expect(src).not.toMatch(/learnerContextBlock|profileBlock/)
  })

  it('submitShortAnswer never fetches a learner profile', () => {
    const src = readFileSync(join(__dirname, '../../src/actions/quiz.ts'), 'utf-8')
    const start = src.indexOf('export async function submitShortAnswer(')
    expect(start).toBeGreaterThan(-1)
    // The body runs to the next top-level export.
    const end = src.indexOf('\nexport ', start + 1)
    const body = src.slice(start, end === -1 ? undefined : end)
    expect(body).not.toContain('safeProfileBlock(')
    expect(body).not.toMatch(/profileBlock/)
  })
})
