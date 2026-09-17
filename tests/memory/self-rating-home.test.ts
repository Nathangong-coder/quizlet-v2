import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Spec 6 §8: the rating lives on StudyEvent and nowhere else. Every erasure
// scope already deletes or cascades StudyEvent, so a second home added later
// would escape the erase planner — this scan makes that a suite failure.
describe('self-rating single-home guard', () => {
  it('selfRating lives on StudyEvent and nowhere else in the schema', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf-8')
    const models = [...schema.matchAll(/model (\w+) \{[\s\S]*?\n\}/g)]
      .filter((m) => /\bselfRating\b/.test(m[0]))
      .map((m) => m[1])
    expect(models).toEqual(['StudyEvent'])
  })

  it('the vocabulary module is Prisma-free', () => {
    const src = readFileSync(join(__dirname, '../../src/lib/memory/self-rating.ts'), 'utf-8')
    expect(src).not.toMatch(/@prisma|@\/lib\/db/)
  })
})
