import { describe, it, expect } from 'vitest'
import { revisionFindings } from '@/lib/klp/authoring'
import { computeSeparation } from '@/lib/klp/separation'
import { REVISION_BAR, SEPARATION_FLOOR } from '@/lib/klp/authoring-config'
import { REVISE_KLPS_PROMPT } from '@/lib/ai/prompts/revise-klps'

const V = (...vs: string[]) => vs as any
const wrongOf = (kind: string, ...vs: string[]) => ({ kind: kind as any, text: kind, verdicts: V(...vs), score: 0 }) as any

describe('revisionFindings — the quality bar', () => {
  it('is empty when a card clears every check', () => {
    const ref = V('correct', 'correct', 'correct', 'correct')
    const wrong = [wrongOf('vague', 'omission', 'omission', 'partial', 'omission')]
    const f = revisionFindings({ separation: computeSeparation({ kind: 'reference', verdicts: ref }, wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))), referenceVerdicts: ref, wrong, defects: [] })
    expect(f).toEqual([])
  })

  it('fires on separation between the floor and the bar, naming the best wrong answer', () => {
    expect(REVISION_BAR).toBeGreaterThan(SEPARATION_FLOOR)
    const ref = V('correct', 'correct', 'correct', 'correct')
    // best wrong scores 0.5 -> separation 0.5: above the floor, below the bar
    const wrong = [wrongOf('memorized_template', 'partial', 'partial', 'partial', 'partial')]
    const f = revisionFindings({ separation: computeSeparation({ kind: 'reference', verdicts: ref }, wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))), referenceVerdicts: ref, wrong, defects: [] })
    expect(f.some((x) => x.index === null && x.issue.includes('does not clear the 0.60 bar') && x.fix.includes('memorized_template'))).toBe(true)
  })

  it('names the point a weak answer passed outright, the point the reference failed, and each hygiene defect with its fix', () => {
    const ref = V('correct', 'partial', 'correct')
    const wrong = [wrongOf('vague', 'correct', 'omission', 'omission')]
    const f = revisionFindings({
      separation: computeSeparation({ kind: 'reference', verdicts: ref }, wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))),
      referenceVerdicts: ref,
      wrong,
      defects: [{ index: 2, rule: 'compound', detail: 'two claims joined by "and"' } as any],
    })
    expect(f.find((x) => x.index === 0)?.issue).toContain('accepted by the vague answer')
    expect(f.find((x) => x.index === 1)?.issue).toContain('reference answer scored partial')
    expect(f.find((x) => x.index === 2)).toMatchObject({ issue: 'compound' })
    expect(f.find((x) => x.index === 2)?.fix).toContain('split')
  })

  it('the revise prompt renders each finding under its point and the card-level reason', () => {
    const prompt = REVISE_KLPS_PROMPT.build({
      question: 'Q',
      klps: [{ text: 'A and B', kind: 'mechanism' }, { text: 'C', kind: 'definition' }],
      discrimination: [
        { index: 0, passesReference: true, failsSomeWrong: true, discriminates: true },
        { index: 1, passesReference: true, failsSomeWrong: true, discriminates: true },
      ],
      findings: [{ index: 0, issue: 'compound', fix: 'split it into two points' }, { index: null, issue: 'separation 0.52 is below the 0.60 bar', fix: 'tighten' }],
      reason: 'separation 0.52 is below the 0.60 bar; [0] compound',
      targetCount: 4,
    })
    expect(prompt).toContain('COMPOUND — split it into two points')
    expect(prompt).toContain('Why this revision: separation 0.52')
    expect(prompt).toContain('Whole-set findings')
    expect(prompt).toContain('Leave a KLP with no finding alone')
    expect(REVISE_KLPS_PROMPT.version).toBe(4)
    expect(prompt).toContain('CUT WORDS, NEVER DISTINCT CLAIMS')
  })
})
