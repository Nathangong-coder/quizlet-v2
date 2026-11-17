import { describe, expect, it } from 'vitest'
import { GAP_ROUTE_CAP, formatCardGap, gapFindings, gapKey, parseCardGaps, pointCoversGap, routeCardGaps, sameGap } from '@/lib/klp/gap-routing'
import { BEYOND_CARD_CAP } from '@/lib/klp/authoring-config'
import { foldReview } from '@/lib/analysis/benchmark-review'
import { PanelGradeReviewSchema } from '@/lib/ai/schemas'
import { REVIEW_PANEL_GRADE_PROMPT } from '@/lib/ai/prompts/review-panel-grade'
import { AUTHOR_KLPS_PROMPT } from '@/lib/ai/prompts/author-klps'

describe('card-gap routing (2026-09-20): gaps go to the key points first, the owner second', () => {
  it('formats a gap as claim then reasoning, on one line, without doubling "because"', () => {
    expect(formatCardGap({ claim: 'Debt is generally cheaper than equity.', reasoning: 'because interest is tax-deductible.' }))
      .toBe('Debt is generally cheaper than equity — because interest is tax-deductible')
    expect(formatCardGap({ claim: ' X ', reasoning: ' Since Y ' })).toBe('X — because Y')
    // One line: every reader of the CARD GAPS: summary suffix splits on newlines.
    expect(formatCardGap({ claim: 'a', reasoning: 'b' })).not.toContain('\n')
  })

  it('de-duplicates on the first six words and ranks by how many answers raised the gap', () => {
    const r = routeCardGaps([
      { cardId: 'c1', gap: 'Interest on acquisition debt is tax-deductible — because it lowers the after-tax cost' },
      { cardId: 'c1', gap: 'Lenders impose covenants — because they limit downside' },
      { cardId: 'c1', gap: 'Interest on acquisition debt is tax deductible, lowering cost — because tax shield' },
      { cardId: 'c1', gap: 'A dividend recap returns capital early — because it re-levers the company' },
      { cardId: 'c2', gap: 'Fund life bounds the hold period — because LPs expect capital back' },
    ])
    expect(r.routed.c1.map((g) => g.support)).toEqual([2, 1])
    expect(r.routed.c1[0].gap).toMatch(/^Interest on acquisition debt is tax-deductible/)
    // Ties keep first appearance: covenants (2nd seen) beats dividend recap (4th).
    expect(r.routed.c1[1].gap).toMatch(/^Lenders impose covenants/)
    expect(r.ownerOnly).toEqual([{ cardId: 'c1', gap: expect.stringMatching(/^A dividend recap/), support: 1 }])
    expect(r.routed.c2).toHaveLength(1)
  })

  it('the routing cap is the author prompt\'s "at most two beyond the card" — one number, enforced in the loop', () => {
    expect(GAP_ROUTE_CAP).toBe(2)
    expect(GAP_ROUTE_CAP).toBe(BEYOND_CARD_CAP)
    expect(AUTHOR_KLPS_PROMPT.build({ setTitle: 'S', term: 'T', definition: 'D', minKlps: 3 })).toContain('AT MOST TWO points beyond the card')
    const r = routeCardGaps(['Covenants limit downside', 'Fund life bounds the hold', 'Revolver funds shortfalls'].map((gap) => ({ cardId: 'c', gap: `${gap} — because r` })), 0)
    expect(r.routed.c).toEqual([])
    expect(r.ownerOnly).toHaveLength(3)
  })

  it('a routed gap becomes a card_gap finding with no previous index and its support named', () => {
    const f = gapFindings([{ gap: 'X — because Y', support: 3 }])
    expect(f).toEqual([{ index: null, text: 'X — because Y', issue: 'card_gap', fix: expect.stringMatching(/BEYOND THE CARD.*3 of the panel/) }])
  })

  it('gapKey ignores case and punctuation and reads only the first six words', () => {
    expect(gapKey('Debt is, generally, cheaper than EQUITY because of the tax shield')).toBe('debt is generally cheaper than equity')
    expect(gapKey('Interest is tax-deductible')).toBe(gapKey('Interest is tax deductible'))
  })

  it('merges near-duplicate wordings into one gap with summed support — measured on the first routed run', () => {
    // These pairs each took BOTH routing slots of a card under the first-six-words rule.
    const stable1 = "LBO targets are generally chosen for stable, predictable cash flows and low capex requirements — because the debt must be serviced from the target's own cash flow"
    const stable2 = "LBO targets generally need stable, predictable cash flows and low capex so free cash flow is available for deleveraging — because the debt must be serviced from the target's own cash flow"
    const levers1 = 'LBO returns come from three drivers: debt paydown, EBITDA growth, and multiple expansion — because equity value grows as debt is repaid'
    const levers2 = 'LBO value creation generally comes from deleveraging, EBITDA growth, and multiple expansion — because equity value rises as debt is paid down'
    const levers3 = 'Sponsors generally create value through debt paydown, EBITDA growth, and multiple expansion — because equity value rises as debt shrinks'
    const mgmt1 = 'A capable, incentivized management team is generally needed because the sponsor relies on it heavily post-close — because the sponsor is buying a company it will not run'
    const mgmt2 = 'Strong management is generally important because a leveraged company cannot easily absorb a leadership rebuild — because with high fixed debt service a misstep is costly'
    expect(sameGap(stable1, stable2)).toBe(true)
    expect(sameGap(levers1, levers2)).toBe(true)
    expect(sameGap(levers1, levers3)).toBe(true)
    expect(sameGap(mgmt1, mgmt2)).toBe(false)
    expect(sameGap(stable1, levers1)).toBe(false)
    const r = routeCardGaps([
      { cardId: 'w', gap: levers1 }, { cardId: 'w', gap: stable1 }, { cardId: 'w', gap: stable2 }, { cardId: 'w', gap: levers2 }, { cardId: 'w', gap: levers3 },
      { cardId: 'w', gap: mgmt1 },
    ])
    expect(r.routed.w.map((g) => [g.gap.slice(0, 11), g.support])).toEqual([['LBO returns', 3], ['LBO targets', 2]])
    expect(r.ownerOnly.map((g) => g.gap.slice(0, 9))).toEqual(['A capable'])
  })

  it('pointCoversGap: a point authored from a gap covers it, an unrelated step does not — measured on the first routed run', () => {
    const revolver = 'Negative free cash flow in a year is funded by drawing the revolver before assuming other sources — because mandatory amortization still must be paid'
    const tranche = 'Optional prepayments follow contractual tranche priority, with Term Loan A typically swept before Term Loan B, which is often bullet and may have no sweep — because the waterfall decides'
    expect(pointCoversGap('When free cash flow is negative in a year, the shortfall is funded by drawing the revolver, because mandatory amortization is still due', revolver)).toBe(true)
    expect(pointCoversGap('Optional prepayments follow contractual tranche priority, so Term Loan A is typically swept before Term Loan B.', tranche)).toBe(true)
    expect(pointCoversGap("Each year's ending balance rolls forward as the next year's starting balance", revolver)).toBe(false)
    expect(pointCoversGap('Free cash flow is measured after interest expense.', revolver)).toBe(false)
  })

  it('reads gaps back off a stored review summary — the inverse of what benchmark-run writes', () => {
    const summary = ['The reader was right about X.', '', 'CARD GAPS:', '- A — because b', '- C — because d', ''].join('\n')
    expect(parseCardGaps(summary)).toEqual(['A — because b', 'C — because d'])
    expect(parseCardGaps('no suffix here')).toEqual([])
  })
})

describe('the quality rule: a gap without its reasoning is a generalisation and is dropped', () => {
  const base = { klpRef: 0, verdict: 'omission', firm: true, reason: 'r' }
  it('foldReview keeps { claim, reasoning } gaps formatted and drops bare strings, counted', () => {
    const f = foldReview(
      { points: [{ ...base, stance: 'hold' }], cardGaps: ['Debt is cheaper than equity', { claim: 'Debt is generally cheaper than equity', reasoning: 'interest is tax-deductible' }, { claim: 'x', reasoning: ' ' }], summary: 's' },
      ['k0'],
      [{ klpRef: 0, status: 'omission' }],
    )
    expect(f.cardGaps).toEqual(['Debt is generally cheaper than equity — because interest is tax-deductible'])
    expect(f.gapsDropped).toBe(2)
    expect(f.outcome).toBe('card_gap')
  })
  it('a review whose only gaps were bare strings is not a card_gap outcome', () => {
    const f = foldReview({ points: [{ ...base, stance: 'hold' }], cardGaps: ['Leverage amplifies returns'], summary: 's' }, ['k0'], [{ klpRef: 0, status: 'omission' }])
    expect(f.cardGaps).toEqual([])
    expect(f.outcome).toBe('strong')
  })
  it('the schema still parses a bare string — the reply is not lost, the gap is', () => {
    expect(PanelGradeReviewSchema.safeParse({ points: [], cardGaps: ['bare', { claim: 'c', reasoning: 'r' }], summary: 's' }).success).toBe(true)
    expect(PanelGradeReviewSchema.safeParse({ points: [], cardGaps: [{ claim: 'c' }], summary: 's' }).success).toBe(false)
  })
  it('review-panel-grade v4 asks for claim + reasoning and names the generalisation it refuses', () => {
    expect(REVIEW_PANEL_GRADE_PROMPT.version).toBe(4)
    const p = REVIEW_PANEL_GRADE_PROMPT.build({ question: 'Q', referenceAnswer: null, klps: [{ ref: 0, kind: 'causal', text: 'k' }], answerText: 'A', graderVerdicts: [{ ref: 0, status: 'omission' }], intendedLabel: 'strong', intendedRationale: 'r', disagreement: 'd' })
    expect(p).toContain('"cardGaps": [ { "claim": string, "reasoning": string } ]')
    expect(p).toMatch(/"reasoning": WHY it holds/)
    expect(p).toContain('"debt is cheaper than equity"')
    expect(p).toMatch(/"claim": "Debt is generally cheaper than equity", "reasoning": "interest is tax-deductible/)
  })
})

describe('author-klps v9 reads routed gaps as beyond-the-card points', () => {
  it('lists card_gap findings in their own block, with [+] instead of a previous index, and binds them to the two-beyond limit', () => {
    const p = AUTHOR_KLPS_PROMPT.build({
      setTitle: 'S', term: 'T', definition: 'D', minKlps: 3,
      priorFindings: [
        { index: 1, text: 'old', issue: 'klp_defect', fix: 'Rewrite.' },
        { index: null, text: 'Debt is generally cheaper than equity — because interest is tax-deductible', issue: 'card_gap', fix: 'Author it.' },
      ],
    })
    expect(p).toContain('[1] DEFECTIVE POINT — "old" — Rewrite.')
    expect(p).toContain('[+] MISSING FROM THE POINTS — "Debt is generally cheaper than equity — because interest is tax-deductible" — Author it.')
    expect(p).toContain('MADE THESE CLAIMS THAT NO PREVIOUS POINT COVERED')
    expect(p).toMatch(/BEYOND THE CARD points \(fromDefinition null/)
    expect(p).toMatch(/count toward the at-most-two limit/)
    expect(p).toMatch(/do not widen a qualified claim into an absolute one/)
    expect(p.indexOf('NO PREVIOUS POINT COVERED')).toBeLessThan(p.indexOf('THE DEFINITION IS YOUR SKELETON'))
  })
  it('gaps alone produce no "FAILED" block; no findings produce neither', () => {
    const gapsOnly = AUTHOR_KLPS_PROMPT.build({ setTitle: 'S', term: 'T', definition: 'D', minKlps: 3, priorFindings: [{ index: null, text: 'g', issue: 'card_gap', fix: 'f' }] })
    expect(gapsOnly).not.toContain('PREVIOUS SET OF KEY POINTS')
    expect(gapsOnly).toContain('NO PREVIOUS POINT COVERED')
    const none = AUTHOR_KLPS_PROMPT.build({ setTitle: 'S', term: 'T', definition: 'D', minKlps: 3 })
    expect(none).not.toContain('NO PREVIOUS POINT COVERED')
  })
})
