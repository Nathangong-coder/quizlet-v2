import { describe, it, expect } from 'vitest'
import {
  RELATION_TYPES, DIRECTED_TYPES, SYMMETRIC_TYPES, isRelationType,
  canonicalizeEdges, findCycles, blastRadius, weightFromBlastRadius,
} from '@/lib/klp/relations'

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
