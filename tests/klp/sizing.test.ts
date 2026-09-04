import { describe, it, expect } from 'vitest'
import { countDefinitionClauses, mechanicalKlpPrior, targetKlpCount } from '@/lib/klp/sizing'
import { MIN_KLPS_FLOOR, MAX_KLPS_AUTHORED } from '@/lib/klp/authoring-config'

describe('countDefinitionClauses', () => {
  it('counts one point in a one-line definition', () => {
    expect(countDefinitionClauses('Leverage amplifies equity returns.')).toBe(1)
  })

  /** The design's own verification case: a six-clause definition. */
  it('counts each point of a six-clause definition', () => {
    const definition = [
      'Debt funds most of the purchase price',
      'the sponsor puts in less equity',
      'interest is tax deductible',
      'cash flow pays the debt down over the hold',
      'the equity stake grows as leverage falls',
      'and the same exit value returns a larger multiple',
    ].join('; ')
    expect(countDefinitionClauses(definition)).toBe(6)
  })

  /**
   * Finance definitions are full of decimals and abbreviations. Splitting on
   * every period would count "1.5x" as a point boundary and inflate every
   * numeric card's target.
   */
  it('does not split on decimals, multiples or abbreviations', () => {
    expect(countDefinitionClauses('The company trades at 1.5x book value on $1,000.00 of equity.')).toBe(1)
    expect(countDefinitionClauses('Non-cash charges, e.g. depreciation, are added back.')).toBe(1)
  })

  it('splits on sentence boundaries, bullets and numbered lists', () => {
    expect(countDefinitionClauses('EBIT falls by ten. Net income falls by six.')).toBe(2)
    expect(countDefinitionClauses('drivers: - lower equity cheque - tax shield - debt paydown')).toBe(3)
    expect(countDefinitionClauses('drivers: 1. lower equity cheque 2. the tax shield 3. debt paydown')).toBe(3)
  })

  it('ignores fragments too short to be a claim', () => {
    expect(countDefinitionClauses('IRR; the sponsor puts in less equity up front')).toBe(1)
  })
})

describe('mechanicalKlpPrior', () => {
  it('is the clause count for a short question and a short definition', () => {
    expect(mechanicalKlpPrior({ question: 'Why leverage?', definition: 'It amplifies equity returns.' })).toBe(1)
  })

  it('adds one for a definition long enough to be multi-part however it is punctuated', () => {
    const long = 'The sponsor funds the purchase largely with debt so the equity cheque is small '.repeat(5)
    expect(mechanicalKlpPrior({ question: 'Why?', definition: long })).toBeGreaterThan(
      mechanicalKlpPrior({ question: 'Why?', definition: 'The sponsor funds it with debt.' }),
    )
  })

  it('adds one for a question that asks more than one thing', () => {
    const definition = 'Leverage amplifies equity returns.'
    const short = mechanicalKlpPrior({ question: 'Why leverage?', definition })
    const long = mechanicalKlpPrior({
      question: 'Why do private equity firms use leverage, and how exactly does it amplify equity returns?',
      definition,
    })
    expect(long).toBe(short + 1)
  })

  /**
   * NOT floored at MIN_KLPS_FLOOR — the floor is applied once, in
   * `targetKlpCount`. Flooring here too would make a thin definition
   * indistinguishable from an average one in any diagnostic printing the prior.
   */
  it('is allowed to be below the floor', () => {
    expect(mechanicalKlpPrior({ question: 'Why?', definition: 'It amplifies returns.' })).toBeLessThan(MIN_KLPS_FLOOR)
  })

  it('never exceeds the authored maximum', () => {
    const many = Array.from({ length: 40 }, (_, i) => `driver number ${i} matters here`).join('; ')
    expect(mechanicalKlpPrior({ question: 'Why?', definition: many })).toBe(MAX_KLPS_AUTHORED)
  })
})

describe('targetKlpCount', () => {
  /** The owner's "base of 4+": a terse card still gets four. */
  it('floors a one-line card at MIN_KLPS_FLOOR', () => {
    expect(targetKlpCount({ prior: 1 })).toBe(MIN_KLPS_FLOOR)
    expect(MIN_KLPS_FLOOR).toBe(4)
  })

  it('takes the mechanical prior when it is the largest', () => {
    expect(targetKlpCount({ prior: 6, points: [{ point: 'a', klpsNeeded: 1 }] })).toBe(6)
  })

  /**
   * The model contributes small integers PER POINT and never the total —
   * summing is arithmetic, and arithmetic is TypeScript's job here, the same
   * division of labour separation and significance already use.
   */
  it('sums the per-point assessment rather than trusting a total', () => {
    expect(
      targetKlpCount({
        prior: 2,
        points: [
          { point: 'equity cheque', klpsNeeded: 2 },
          { point: 'tax shield', klpsNeeded: 2 },
          { point: 'debt paydown', klpsNeeded: 2 },
        ],
      }),
    ).toBe(6)
  })

  it('degrades to the prior and the floor when the model omits its assessment', () => {
    expect(targetKlpCount({ prior: 5 })).toBe(5)
    expect(targetKlpCount({ prior: 5, points: [] })).toBe(5)
  })

  it('never exceeds MAX_KLPS_AUTHORED', () => {
    expect(targetKlpCount({ prior: 9, points: [{ point: 'a', klpsNeeded: 50 }] })).toBe(MAX_KLPS_AUTHORED)
  })

  it('ignores a negative or fractional klpsNeeded rather than letting it drag the total', () => {
    expect(targetKlpCount({ prior: 1, points: [{ point: 'a', klpsNeeded: -5 }] })).toBe(MIN_KLPS_FLOOR)
    expect(
      targetKlpCount({ prior: 1, points: Array.from({ length: 12 }, () => ({ point: 'a', klpsNeeded: 0.9 })) }),
    ).toBe(MIN_KLPS_FLOOR)
  })
})
