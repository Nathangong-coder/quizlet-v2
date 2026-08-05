import { describe, it, expect } from 'vitest'
import { computeSignificance, STAR_BOOST } from '@/lib/errors/significance'

const base = { relevance: 3, severity: 3, dimension: 'accuracy' as const, starred: false }

describe('computeSignificance', () => {
  it('computes the frozen formula', () => {
    // (0.55*5 + 0.45*5) * 2 * 1.0 * 1.0 = 10
    expect(computeSignificance({ ...base, relevance: 5, severity: 5 }).significance).toBe(10)
    // (0.55*1 + 0.45*1) * 2 * 1.0 * 1.0 = 2
    expect(computeSignificance({ ...base, relevance: 1, severity: 1 }).significance).toBe(2)
    // (0.55*3 + 0.45*3) * 2 = 6
    expect(computeSignificance(base).significance).toBe(6)
  })

  it('weights relevance above severity', () => {
    // Centrality to the question matters more than how bad the slip was — but
    // only just. The 0.55/0.45 split moves the raw score by at most
    // (0.55-0.45) * 4 * 2 = 0.8, which is LESS THAN ONE INTEGER STEP, so on
    // most inputs it vanishes in the rounding: r=5,s=1 gives 6.4 and r=1,s=5
    // gives 5.6, and both round to 6.
    //
    // It is asserted here on a starred card, where the 1.15 boost pushes the
    // pair across a rounding boundary (7.36 -> 7 versus 6.44 -> 6) and the
    // weighting becomes observable. Asserting it on the plain case would be
    // asserting something that is not reliably true.
    const highRelevance = computeSignificance({ ...base, relevance: 5, severity: 1, starred: true })
    const highSeverity = computeSignificance({ ...base, relevance: 1, severity: 5, starred: true })
    expect(highRelevance.significance).toBeGreaterThan(highSeverity.significance)
  })

  it('collapses the relevance/severity split when rounding swallows it', () => {
    // Documents the above as intended behaviour rather than a latent bug: at
    // 1-5 integer inputs the split is a tiebreaker, and the dimension weight
    // and star boost do the real separating.
    expect(computeSignificance({ ...base, relevance: 5, severity: 1 }).significance)
      .toBe(computeSignificance({ ...base, relevance: 1, severity: 5 }).significance)
  })

  it('scales down by dimension — accuracy outranks clarity outranks conciseness', () => {
    const acc = computeSignificance({ ...base, dimension: 'accuracy' }).significance
    const cla = computeSignificance({ ...base, dimension: 'clarity' }).significance
    const con = computeSignificance({ ...base, dimension: 'conciseness' }).significance
    expect(acc).toBeGreaterThan(cla)
    expect(cla).toBeGreaterThan(con)
  })

  it('boosts a starred card', () => {
    const plain = computeSignificance(base).significance
    const starred = computeSignificance({ ...base, starred: true }).significance
    expect(starred).toBeGreaterThan(plain)
    expect(STAR_BOOST).toBe(1.15)
  })

  it('clamps to 1-10 at both ends', () => {
    expect(computeSignificance({
      relevance: 5, severity: 5, dimension: 'accuracy', starred: true,
    }).significance).toBe(10)
    expect(computeSignificance({
      relevance: 1, severity: 1, dimension: 'conciseness', starred: false,
    }).significance).toBeGreaterThanOrEqual(1)
  })

  it('returns the INPUTS, not the derived constants', () => {
    // Storing dimWeight=1.0 does not let you recompute at 0.9; storing the
    // dimension does. So the result carries facts, and significance.
    const r = computeSignificance({ ...base, starred: true })
    expect(r).toEqual({
      relevance: 3, severity: 3, dimension: 'accuracy', starred: true,
      significance: expect.any(Number),
    })
    expect(r).not.toHaveProperty('dimWeight')
    expect(r).not.toHaveProperty('starBoost')
  })
})
