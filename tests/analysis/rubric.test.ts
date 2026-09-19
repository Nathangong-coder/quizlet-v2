import { describe, it, expect } from 'vitest'
import { scoreExpression, CLARITY_ITEMS, CONCISENESS_ITEMS, MODEL_RUBRIC_ITEMS, RUBRIC_VERSION, rubricPromptBlock, PROPORTIONATE_MAX_RATIO } from '@/lib/analysis/rubric'

describe('the mechanical communication rubric', () => {
  it('weights sum to 100 per dimension and every model item is asked in the prompt', () => {
    expect(CLARITY_ITEMS.reduce((n, i) => n + i.weight, 0)).toBe(100)
    expect(CONCISENESS_ITEMS.reduce((n, i) => n + i.weight, 0)).toBe(100)
    const block = rubricPromptBlock()
    for (const i of MODEL_RUBRIC_ITEMS) expect(block).toContain(`"${i.id}"`)
    expect(block).not.toContain('"proportionate"') // computed by TS, never asked
  })
  it('scores from the answers; a met item earns its weight, an unmet one nothing', () => {
    const all = MODEL_RUBRIC_ITEMS.map((i) => ({ id: i.id, met: true }))
    const s = scoreExpression({ contentScore: 0.83, modelAnswers: all, answerText: 'ten words here ok ok ok ok ok ok ok', referenceText: 'twelve words in the reference x x x x x x x x' })
    expect(s).toMatchObject({ rubricVersion: RUBRIC_VERSION, accuracy: 83, clarity: 100, conciseness: 100, warnings: [] })
    const lede = MODEL_RUBRIC_ITEMS.map((i) => ({ id: i.id, met: i.id !== 'lede', quote: i.id === 'lede' ? 'Background first.' : undefined }))
    expect(scoreExpression({ contentScore: 1, modelAnswers: lede, answerText: 'a', referenceText: 'a' }).clarity).toBe(70)
  })
  it('a missing item scores as not met and is warned, never silently passed', () => {
    const partial = MODEL_RUBRIC_ITEMS.filter((i) => i.id !== 'no_padding').map((i) => ({ id: i.id, met: true }))
    const s = scoreExpression({ contentScore: 1, modelAnswers: partial, answerText: 'a', referenceText: null })
    expect(s.conciseness).toBe(70)
    expect(s.warnings).toContain('rubric_unanswered:no_padding')
    expect(s.items.find((i) => i.id === 'no_padding')).toMatchObject({ met: false, answered: false })
  })
  it('v2: proportionate is computed from word counts against the DEFINITION, the reference only as a fallback', () => {
    expect(RUBRIC_VERSION).toBe(2)
    const all = MODEL_RUBRIC_ITEMS.map((i) => ({ id: i.id, met: true }))
    const def = Array(20).fill('w').join(' ')
    const ref = Array(200).fill('w').join(' ') // the bloated reference must not rescue a long answer
    const ok = Array(Math.floor(20 * PROPORTIONATE_MAX_RATIO)).fill('w').join(' ')
    const long = Array(Math.floor(20 * PROPORTIONATE_MAX_RATIO) + 1).fill('w').join(' ')
    expect(scoreExpression({ contentScore: 1, modelAnswers: all, answerText: ok, definitionText: def, referenceText: ref }).conciseness).toBe(100)
    const s = scoreExpression({ contentScore: 1, modelAnswers: all, answerText: long, definitionText: def, referenceText: ref })
    expect(s.conciseness).toBe(80)
    expect(s.items.find((i) => i.id === 'proportionate')?.quote).toMatch(/in the definition$/)
    // No definition text: the reference is the yardstick; neither: always met.
    expect(scoreExpression({ contentScore: 1, modelAnswers: all, answerText: long, definitionText: '', referenceText: def }).items.find((i) => i.id === 'proportionate')?.quote).toMatch(/in the reference$/)
    expect(scoreExpression({ contentScore: 1, modelAnswers: all, answerText: long, referenceText: null }).conciseness).toBe(100)
  })
  it('an unknown item id is warned', () => {
    const s = scoreExpression({ contentScore: 0, modelAnswers: [{ id: 'vibes', met: true }], answerText: 'a', referenceText: null })
    expect(s.warnings).toContain('rubric_unknown_item:vibes')
    expect(s.accuracy).toBe(0)
  })
})
