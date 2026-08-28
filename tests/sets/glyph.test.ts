import { describe, it, expect } from 'vitest'
import { buildGlyph } from '@/lib/sets/glyph'

describe('buildGlyph', () => {
  it('is deterministic for the same seed', () => {
    // A glyph that changes between renders or between pages is not an
    // identity, it is noise.
    expect(buildGlyph('set-abc', 4)).toEqual(buildGlyph('set-abc', 4))
  })

  it('differs between seeds', () => {
    expect(buildGlyph('set-abc', 4)).not.toEqual(buildGlyph('set-xyz', 4))
  })

  it('renders at least one node even with no categories', () => {
    // An uncategorized set still needs a mark. An empty glyph reads as a
    // failed render, not as "no categories".
    expect(buildGlyph('s', 0).length).toBeGreaterThan(0)
  })

  it('floors the node count so a mark is a constellation, not a lone dot', () => {
    // NOT in the plan's draft, which floored at 1. Categories are opt-in and
    // most sets have none, so a floor of 1 makes the single-dot case the
    // COMMON case — and one 5px dot in a 48px box reads as a failed render.
    for (const count of [0, 1, 2, 3]) {
      expect(buildGlyph('s', count).length, String(count)).toBeGreaterThanOrEqual(3)
    }
  })

  it('still tracks the category count above the floor', () => {
    expect(buildGlyph('s', 5)).toHaveLength(5)
    expect(buildGlyph('s', 6)).toHaveLength(6)
  })

  it('caps the node count so a 40-category set does not become mush', () => {
    expect(buildGlyph('s', 40).length).toBeLessThanOrEqual(7)
  })

  it('keeps every node inside the 0..1 unit box', () => {
    for (const n of buildGlyph('seed-with-some-length', 5)) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(1)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(1)
      expect(n.r).toBeGreaterThan(0)
    }
  })
})
