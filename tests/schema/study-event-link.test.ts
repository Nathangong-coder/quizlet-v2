import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const schema = readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8')

/**
 * The cascade is the mechanism that keeps a graded answer and its memory-feed
 * row together — application code never deletes the event explicitly. There is
 * no live-DB harness here, so the guarantee is pinned against the schema text.
 */
describe('StudyEvent -> QuizAnswer link', () => {
  it('declares quizAnswerId as a unique nullable column', () => {
    expect(schema).toMatch(/quizAnswerId\s+String\?\s+@unique/)
  })

  it('cascades the event away when its answer is deleted', () => {
    expect(schema).toMatch(
      /quizAnswer\s+QuizAnswer\?\s+@relation\(fields:\s*\[quizAnswerId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
    )
  })
})
