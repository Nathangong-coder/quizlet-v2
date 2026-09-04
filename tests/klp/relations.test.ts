import { describe, it, expect } from 'vitest'
import {
  RELATION_TYPES, DIRECTED_TYPES, SYMMETRIC_TYPES, RELATABLE_TYPES, isRelationType,
  canonicalizeEdges, findCycles, blastRadius, weightFromBlastRadius, weightFromSignals,
} from '@/lib/klp/relations'
import type { RelationEdge } from '@/lib/klp/relations'

describe('the vocabulary', () => {
  it('has no part_of — that is the concept tree, not a KLP relation', () => {
    expect(RELATION_TYPES).not.toContain('part_of')
  })

  it('splits cleanly into directed and symmetric with nothing left over', () => {
    expect([...DIRECTED_TYPES, ...SYMMETRIC_TYPES].sort()).toEqual([...RELATION_TYPES].sort())
    for (const t of SYMMETRIC_TYPES) expect(DIRECTED_TYPES).not.toContain(t)
  })

  it('narrows only real members', () => {
    expect(isRelationType('causes')).toBe(true)
    expect(isRelationType('contrasts')).toBe(false)
    expect(isRelationType(undefined)).toBe(false)
  })

  /**
   * The authoring pipeline's relate call (Spec 2) is only allowed to emit
   * this subset — `analogous_to` is cross-card. Pinned here so the two
   * consumers (the prompt's offered-types list and `RelationDraftSchema`)
   * cannot silently diverge from what this constant actually contains.
   */
  it('RELATABLE_TYPES is exactly RELATION_TYPES minus analogous_to', () => {
    expect([...RELATABLE_TYPES].sort())
      .toEqual(RELATION_TYPES.filter((t) => t !== 'analogous_to').sort())
    expect(RELATABLE_TYPES).not.toContain('analogous_to')
  })
})

describe('canonicalizeEdges', () => {
  it('orders symmetric endpoints so one pair cannot be stored twice', () => {
    const out = canonicalizeEdges([{ from: 3, to: 1, type: 'confused_with' }])
    expect(out[0]).toEqual({ from: 1, to: 3, type: 'confused_with' })
  })

  it('leaves directed endpoints alone — direction is the information', () => {
    const out = canonicalizeEdges([{ from: 3, to: 1, type: 'causes' }])
    expect(out[0]).toEqual({ from: 3, to: 1, type: 'causes' })
  })

  it('collapses a symmetric pair emitted in both directions', () => {
    const out = canonicalizeEdges([
      { from: 1, to: 2, type: 'confused_with' },
      { from: 2, to: 1, type: 'confused_with' },
    ])
    expect(out).toHaveLength(1)
  })
})

describe('findCycles', () => {
  /**
   * The shape this exists to catch: a model emits X causes Y in one call and
   * Y causes X in another, and neither call can see the other.
   */
  it('finds a two-node cycle across directed edges', () => {
    const cycles = findCycles([
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 0, type: 'causes' },
    ])
    expect(cycles.length).toBeGreaterThan(0)
  })

  it('finds a three-node cycle', () => {
    const cycles = findCycles([
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 2, type: 'requires' },
      { from: 2, to: 0, type: 'precedes' },
    ])
    expect(cycles.length).toBeGreaterThan(0)
  })

  it('accepts a diamond — shared ancestry is not a cycle', () => {
    expect(findCycles([
      { from: 0, to: 1, type: 'causes' },
      { from: 0, to: 2, type: 'causes' },
      { from: 1, to: 3, type: 'causes' },
      { from: 2, to: 3, type: 'causes' },
    ])).toEqual([])
  })

  /** Symmetric edges are not dependencies and must be exempt. */
  it('ignores symmetric edges entirely', () => {
    expect(findCycles([
      { from: 0, to: 1, type: 'confused_with' },
      { from: 1, to: 0, type: 'confused_with' },
    ])).toEqual([])
  })
})

describe('blastRadius', () => {
  /**
   * The user's own worked example, reduced: K3 (non-cash) causes K4 (CFO up),
   * K1 (EBIT down) causes K2 (NI down) which precedes K4.
   */
  it('counts everything downstream, transitively', () => {
    const r = blastRadius(5, [
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 3, type: 'precedes' },
      { from: 2, to: 3, type: 'causes' },
    ])
    expect(r[0]).toBe(2)  // 1 and 3
    expect(r[1]).toBe(1)  // 3
    expect(r[2]).toBe(1)  // 3
    expect(r[3]).toBe(0)  // leaf
    expect(r[4]).toBe(0)  // disconnected
  })

  it('counts a descendant once even when two paths reach it', () => {
    const r = blastRadius(4, [
      { from: 0, to: 1, type: 'causes' },
      { from: 0, to: 2, type: 'causes' },
      { from: 1, to: 3, type: 'causes' },
      { from: 2, to: 3, type: 'causes' },
    ])
    expect(r[0]).toBe(3)
  })

  it('ignores symmetric edges — they are not dependencies', () => {
    expect(blastRadius(2, [{ from: 0, to: 1, type: 'confused_with' }])).toEqual([0, 0])
  })

  it('terminates on a cycle instead of hanging', () => {
    const r = blastRadius(2, [
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 0, type: 'causes' },
    ])
    expect(r[0]).toBe(1)
    expect(r[1]).toBe(1)
  })
})

describe('weightFromBlastRadius', () => {
  /**
   * G1: 92% of AI-assigned weights were 4 or 5, so significance never spanned
   * 1-10. A graph property spreads because the graph spreads.
   */
  it('maps a leaf to 1 and a wide root to 5', () => {
    expect(weightFromBlastRadius(0)).toBe(1)
    expect(weightFromBlastRadius(1)).toBe(2)
    expect(weightFromBlastRadius(4)).toBe(5)
    expect(weightFromBlastRadius(50)).toBe(5)
  })
})

describe('weightFromSignals', () => {
  /**
   * The blend must be a GENERALISATION of the graph-only formula, not a
   * re-scaling of it — otherwise every weight already written silently means
   * something different. With the evidence term at zero the two agree exactly.
   */
  it('reduces to weightFromBlastRadius when the evidence term is weighted out', () => {
    const graphOnly = { graph: 1, evidence: 0 }
    for (const radius of [0, 1, 2, 3, 4, 5, 50]) {
      expect(weightFromSignals(radius, 0.5, graphOnly)).toBe(weightFromBlastRadius(radius))
    }
  })

  /**
   * The cost of weighting the two terms to sum to 1, pinned so it cannot be
   * rediscovered as a surprise: a KLP reaches 5 only by scoring on BOTH terms.
   * An enumeration card has no graph term at all, so under equal weighting its
   * most load-bearing point tops out at 3 — and weight is `relevance` in
   * `computeSignificance`, which aggregates across cards. This is precisely
   * what the weight histogram is watching for.
   */
  it('caps a card that can only score on one term at 3 under equal weighting', () => {
    expect(weightFromSignals(0, 1)).toBe(3)
    expect(weightFromSignals(99, 0)).toBe(3)
    expect(weightFromSignals(99, 1)).toBe(5)
  })

  /**
   * A DERIVATION CHAIN — the shape the original formula was designed around.
   * The graph term does the work and the weights span the range.
   */
  it('spreads weights on a chain-shaped card', () => {
    const chain: RelationEdge[] = [
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 2, type: 'causes' },
      { from: 2, to: 3, type: 'causes' },
      { from: 3, to: 4, type: 'causes' },
    ]
    const radii = blastRadius(5, chain)
    const weights = radii.map((r) => weightFromSignals(r, 1))
    expect(new Set(weights).size).toBeGreaterThan(2)
    expect(Math.max(...weights)).toBe(5)
    expect(Math.min(...weights)).toBeLessThan(5)
  })

  /**
   * AN ENUMERATION — the case the graph-only formula fails, and the reason this
   * function exists. Five parallel drivers, no dependencies, so every blast
   * radius is 0; the old formula gave all five a weight of 1. The adversarial
   * evidence still separates them.
   */
  it('spreads weights on an enumeration-shaped card, where the graph term is flat', () => {
    const radii = blastRadius(5, [])
    expect(radii).toEqual([0, 0, 0, 0, 0])
    expect(new Set(radii.map(weightFromBlastRadius)).size).toBe(1)

    const breadths = [1, 2 / 3, 2 / 3, 1 / 3, 0]
    const weights = radii.map((r, i) => weightFromSignals(r, breadths[i]))
    expect(new Set(weights).size).toBeGreaterThan(1)
    expect(weights[0]).toBeGreaterThan(weights[4])
  })

  it('clamps both inputs into 1-5', () => {
    expect(weightFromSignals(-3, -1)).toBe(1)
    expect(weightFromSignals(99, 99)).toBe(5)
  })
})
