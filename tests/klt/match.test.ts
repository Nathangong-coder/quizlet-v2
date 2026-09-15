import { describe, it, expect } from 'vitest'
import { matchConcept, sweep, tokenJaccard, initialsOf, TOKEN_MATCH, TOKEN_AMBIGUOUS } from '@/lib/klt/match'

const V = (...names: string[]) => names.map((n, i) => ({ kltId: `k${i}`, name: n, normalizedName: n.toLowerCase(), aliases: [] as string[] }))

describe('matchConcept against stored (tree-form) names', () => {
  it('exact-matches a stored plural name whose matcher form is singular (M&A rebuild 2026-09-15)', () => {
    const vocab = [{ kltId: 'k1', name: 'earnings per share', normalizedName: 'earnings per share', status: 'active', aliases: [] }]
    const r = matchConcept('earnings per share', vocab)
    expect(r.kind).toBe('match')
    if (r.kind === 'match') expect(r.rule).toBe('exact')
    const under = matchConcept('earnings per share dilution', vocab)
    expect(under.kind).toBe('related')
  })
})

describe('matchConcept — the distinctness matcher', () => {
  it('exact after normalization: abbreviations expand, plurals singularize, noise suffixes drop', () => {
    const vocab = V('free cash flow', 'working capital')
    expect(matchConcept('FCF', vocab)).toMatchObject({ kind: 'match', rule: 'exact', entry: { name: 'free cash flow' } })
    expect(matchConcept('working capital calculation', vocab)).toMatchObject({ kind: 'match', rule: 'exact', entry: { name: 'working capital' } })
  })

  it('alias: a recorded second spelling matches without a judge', () => {
    const vocab = [{ kltId: 'k0', name: 'time value of money', normalizedName: 'time value of money', aliases: ['tvm'] }]
    expect(matchConcept('TVM', vocab)).toMatchObject({ kind: 'match', rule: 'alias' })
  })

  it('initials: three or more content words against their initials, either direction', () => {
    expect(initialsOf('time value of money')).toBe('tvm')
    expect(initialsOf('net income')).toBeNull()
    expect(matchConcept('tvm', V('time value of money'))).toMatchObject({ kind: 'match', rule: 'initials' })
    expect(matchConcept('discounted cash flow', V('dcf'))).toMatchObject({ kind: 'match', rule: 'initials' })
  })

  it('containment across cards is RELATED, not identity: the specific name is its own node placed under the general one', () => {
    expect(matchConcept('acquired deferred revenue write-down', V('deferred revenue'))).toMatchObject({ kind: 'related', rule: 'containment', entry: { name: 'deferred revenue' } })
    expect(matchConcept('deferred revenue', V('deferred revenue fair value write-down'))).toMatchObject({ kind: 'related' })
    // one shared token is not containment
    expect(matchConcept('deferred revenue', V('revenue recognition')).kind).not.toBe('related')
  })

  it('token overlap: at or above TOKEN_MATCH is a match, between the thresholds is ambiguous, below is none', () => {
    expect(TOKEN_MATCH).toBeGreaterThan(TOKEN_AMBIGUOUS)
    expect(tokenJaccard('deferred revenue write down', 'deferred revenue write off')).toBeCloseTo(3 / 5)
    const r = matchConcept('deferred revenue write down', V('deferred revenue write off'))
    expect(r.kind).toBe('ambiguous')
    expect(matchConcept('goodwill impairment', V('deferred revenue'))).toEqual({ kind: 'none' })
  })

  it('two equal containment hits are ambiguous, never picked by luck', () => {
    const r = matchConcept('working capital', V('net working capital', 'working capital adjustment'))
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.candidates.map((c) => c.entry.name).sort()).toEqual(['net working capital', 'working capital adjustment'])
  })

  it('a retired topic never matches', () => {
    expect(matchConcept('goodwill', [{ kltId: 'k0', name: 'goodwill', normalizedName: 'goodwill', status: 'retired' }])).toEqual({ kind: 'none' })
  })
})

describe('sweep — cross-card accumulation', () => {
  it('a name minted by an earlier card matches a later card, and non-exact matches become aliases', () => {
    const { decisions, vocab } = sweep(['Time value of money', 'TVM', 'goodwill impairment', 'impairment of goodwill', 'synergies'], [])
    expect(decisions.map((d) => d.outcome)).toEqual(['new', 'existing', 'new', 'existing', 'new'])
    expect(decisions[1].resolvedTo.name).toBe('Time value of money')
    // same tokens both ways is exact after normalization, not containment
    expect(decisions[3].result).toMatchObject({ kind: 'match', rule: 'exact' })
    expect(vocab.find((e) => e.name === 'Time value of money')?.aliases).toContain('tvm')
    expect(vocab).toHaveLength(3)
  })

  it('a containment hit mints the specific name as a new node placed under the general one', () => {
    const { decisions, vocab } = sweep(['deferred revenue', 'acquired deferred revenue write-down'], [])
    expect(decisions[1].outcome).toBe('new-under')
    expect(decisions[1].placeUnder?.name).toBe('deferred revenue')
    expect(vocab.map((v) => v.name)).toEqual(['deferred revenue', 'acquired deferred revenue write-down'])
  })

  it('an unresolved ambiguity is minted as new and marked so a judge can revisit it', () => {
    const { decisions } = sweep(['deferred revenue write off', 'deferred revenue write down'], [])
    expect(decisions[1].outcome).toBe('ambiguous-new')
  })
})
