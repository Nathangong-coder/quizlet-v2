import { describe, it, expect } from 'vitest'
import { verboseDefect, wordRatio, compressionFindings, ratioFinding, VERBOSE_POINT_WORDS, REBUILD_WORD_RATIO_BAR, clauseMarkerCount } from '@/lib/klp/compression'
import { validateKlpSet } from '@/lib/klp/validate'
import { REVIEW_REBUILT_PROMPT } from '@/lib/ai/prompts/review-reference'
import { WRITE_REBUILD_PROMPT } from '@/lib/ai/prompts/rebuild'

describe('verboseDefect (step C)', () => {
  it('passes a short point with one because-clause', () => {
    expect(verboseDefect('Depreciation is added back because it is a non-cash charge')).toBeNull()
  })
  it('fails a point over the word bound', () => {
    const long = Array.from({ length: VERBOSE_POINT_WORDS + 1 }, (_, i) => `w${i}`).join(' ')
    expect(verboseDefect(long)).toContain(`${VERBOSE_POINT_WORDS + 1} words`)
  })
  it('fails a point with two subordinate clauses even when short', () => {
    const t = 'EPS falls because financing costs 10%, which is why the deal is dilutive'
    expect(clauseMarkerCount(t)).toBe(2)
    expect(verboseDefect(t)).toContain('subordinate clauses')
  })
  it('is wired into validateKlpSet as the verbose rule', () => {
    const d = validateKlpSet([{ text: 'EPS falls because financing costs 10%, which is why the deal is dilutive' }, { text: 'Short claim' }], 'Q', { targetCount: 1 })
    expect(d.find((x) => x.rule === 'verbose')?.index).toBe(0)
  })
})

describe('wordRatio and ratioFinding', () => {
  it('is rebuilt over reference words, and only a ratio past the bar is a finding', () => {
    expect(wordRatio('a b c d', 'a b')).toBe(2)
    expect(wordRatio('a', '')).toBeNull()
    expect(ratioFinding(1.1)).toBeNull()
    expect(ratioFinding(REBUILD_WORD_RATIO_BAR)).toBeNull()
    expect(ratioFinding(1.35)?.issue).toContain('1.35x')
    expect(ratioFinding(null)).toBeNull()
  })
})

describe('compressionFindings (step A)', () => {
  it('turns restatement into one finding per point naming the others, clause bloat and not-on-card into per-point findings, and drops transitions and bad indices', () => {
    const f = compressionFindings(
      {
        conciseness: 'wordy',
        clarity: 'clear',
        issues: [
          { kind: 'restatement', points: [0, 7, 7], text: 'both say accretion is not value' },
          { kind: 'clause_bloat', points: [3], text: 'because-clause adds nothing' },
          { kind: 'not_on_card', points: [5, 42], text: 'exclusivity is not on the card' },
          { kind: 'transition', points: [], text: 'roadmap' },
          { kind: 'clause_bloat', points: [], text: 'no index given' },
        ],
      },
      8,
    )
    expect(f.map((x) => [x.index, x.issue.split(':')[0]])).toEqual([
      [0, 'restatement with [7]'],
      [7, 'restatement with [0]'],
      [3, 'clause bloat'],
      [5, 'not on the card'],
    ])
    expect(f[0].fix).toContain('keep ONE')
    expect(compressionFindings(undefined, 8)).toEqual([])
  })
})

describe('the prompts', () => {
  it('review-rebuilt shows the numbered points and asks for point indices per issue', () => {
    const p = REVIEW_REBUILT_PROMPT.build({ question: 'Q', definition: 'D', rebuiltAnswer: 'A', klps: [{ text: 'k0' }, { text: 'k1' }] })
    expect(p).toContain('[0] k0')
    expect(p).toContain('[1] k1')
    for (const k of ['restatement', 'clause_bloat', 'not_on_card', 'transition']) expect(p).toContain(`"${k}"`)
    expect(p).toContain('"points": [ number ]')
  })
  it('rebuild v2 says each point once and forbids transitions and a restated conclusion', () => {
    const p = WRITE_REBUILD_PROMPT.build({ question: 'Q', klps: [{ text: 'k' }] })
    expect(WRITE_REBUILD_PROMPT.version).toBe(2)
    expect(p).toContain('Say each point ONCE')
    expect(p).toContain('no restated conclusion')
    expect(p).toContain('about the length of the points combined')
  })
})
