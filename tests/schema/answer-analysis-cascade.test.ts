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

// Spec 5 Phase A: the same golden-vector pattern for the new answer-child
// tables and CardFormRequirement — each must cascade from its parent so
// resubmission (or card/set deletion) never orphans a diagnostic row.
describe('Spec 5 Phase A tables cascade from their parents', () => {
  it('AnswerRelationResult.quizAnswer cascades on delete', () => {
    expect(relationBlock('AnswerRelationResult', 'quizAnswer')).toContain('onDelete: Cascade')
  })

  it('AnswerFormResult.quizAnswer cascades on delete', () => {
    expect(relationBlock('AnswerFormResult', 'quizAnswer')).toContain('onDelete: Cascade')
  })

  it('AnswerUnwarrantedClaim.quizAnswer cascades on delete', () => {
    expect(relationBlock('AnswerUnwarrantedClaim', 'quizAnswer')).toContain('onDelete: Cascade')
  })

  it('CardFormRequirement.card cascades on delete', () => {
    expect(relationBlock('CardFormRequirement', 'card')).toContain('onDelete: Cascade')
  })
})

// Spec 5 §8: the grader benchmark's three tables. A re-authored card
// invalidates its panel (the panel is keyed on klpVersion and a deleted card
// must take its panels with it); a deleted panel must take its answers, and
// an answer its grader results — otherwise a benchmark re-run reads verdicts
// on answers no longer on any panel.
describe('Spec 5 §8 grader-panel tables cascade from their parents', () => {
  it('GraderPanel.card cascades on delete', () => {
    expect(relationBlock('GraderPanel', 'card')).toContain('onDelete: Cascade')
  })

  it('GraderPanelAnswer.panel cascades on delete', () => {
    expect(relationBlock('GraderPanelAnswer', 'panel')).toContain('onDelete: Cascade')
  })

  it('GraderPanelResult.answer cascades on delete', () => {
    expect(relationBlock('GraderPanelResult', 'answer')).toContain('onDelete: Cascade')
  })

  it('one panel per (card, klpVersion, kind), and every persisted AI artifact records its model', () => {
    const panel = schema.match(/model GraderPanel \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(panel).toMatch(/@@unique\(\[cardId, klpVersion, kind\]\)/)
    expect(panel).toMatch(/^\s*model\s+String\s*$/m)
    expect(panel).toMatch(/^\s*promptVersion\s+Int\s*$/m)
    const result = schema.match(/model GraderPanelResult \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(result).toMatch(/^\s*model\s+String\s*$/m)
    expect(result).toMatch(/^\s*graderVersion\s+Int\s*$/m)
    expect(result).toMatch(/^\s*promptVersion\s+Int\s*$/m)
    for (const col of ['verdicts', 'relationVerdicts', 'formVerdicts']) {
      expect(result).toMatch(new RegExp(`^\\s*${col}\\s+Json\\s*$`, 'm'))
    }
    expect(result).toMatch(/^\s*unresolvedQuotes\s+Int\s*$/m)
  })

  it('one result per (answer, graderVersion, model) — the bench planner\'s idempotency key, enforced', () => {
    const result = schema.match(/model GraderPanelResult \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(result).toMatch(/@@unique\(\[answerId, graderVersion, model\]\)/)
    const migration = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260917140000_grader_panel_result_unique/migration.sql'),
      'utf8',
    )
    expect(migration).toMatch(/CREATE UNIQUE INDEX "GraderPanelResult_answerId_graderVersion_model_key"/)
    // Additive only: one statement, nothing dropped or altered.
    expect(migration.match(/^(CREATE|ALTER|DROP)\b/gm)).toEqual(['CREATE'])
  })
})
