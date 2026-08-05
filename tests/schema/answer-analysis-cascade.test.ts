import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Spec 2a §4.1 explicitly requires this be pinned: "A test must pin that" —
// resubmitting an answer deletes the old QuizAnswer row, and its analysis
// rows must cascade rather than orphan. This repo has no real-database
// integration tests anywhere (every test mocks Prisma), so a live cascade
// can't be exercised directly. This is the next best thing: a golden-vector
// read of the schema text itself, same pattern as
// tests/security/api-key.test.ts pinning the encryption payload format.
// If either relation is ever changed away from Cascade, this fails loudly
// instead of resubmission silently accumulating duplicate diagnostic rows.
const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf-8')

function relationBlock(model: string, fieldName: string): string {
  const modelMatch = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))
  if (!modelMatch) throw new Error(`model ${model} not found in schema.prisma`)
  const fieldMatch = modelMatch[0].match(new RegExp(`^\\s*${fieldName}\\s+.*$`, 'm'))
  if (!fieldMatch) throw new Error(`field ${fieldName} not found on model ${model}`)
  return fieldMatch[0]
}

describe('AnswerKlpResult / AnswerErrorTag cascade from QuizAnswer', () => {
  it('AnswerKlpResult.quizAnswer cascades on delete', () => {
    expect(relationBlock('AnswerKlpResult', 'quizAnswer')).toContain('onDelete: Cascade')
  })

  it('AnswerErrorTag.quizAnswer cascades on delete', () => {
    expect(relationBlock('AnswerErrorTag', 'quizAnswer')).toContain('onDelete: Cascade')
  })
})
