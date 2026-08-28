/**
 * A small deterministic constellation standing in for a set's shape.
 *
 * DERIVED FROM CATEGORY COUNT ONLY, never from `SetKltNode`. Loading a concept
 * tree per row in a paginated directory is how this feature becomes slow, and
 * at 48px the visual difference is nil.
 *
 * Deterministic from the seed, so a set's mark is stable across renders and
 * across pages — a glyph that changes is noise, not an identity.
 *
 * Coordinates are in a 0..1 unit box; the component maps them to its viewBox.
 */

export interface GlyphNode {
  x: number
  y: number
  r: number
}

/** Beyond this, a 48px mark is mush rather than a constellation. */
const MAX_NODES = 7

/**
 * Below this, a 48px mark is not a constellation either — it is one dot, which
 * reads as a bullet or a failed render rather than as an identity.
 *
 * DELIBERATE DEVIATION from the plan's draft, which floored at 1. Categories
 * are opt-in and most sets have none, so a floor of 1 would have made the
 * SINGLE-DOT case the common case and the whole mark read as filler. The seed
 * still makes every set's glyph distinct below the floor; what is lost is only
 * the count read-out at 0..3 categories, which was never legible at this size.
 */
const MIN_NODES = 3

/** FNV-1a. Small, dependency-free, and adequately mixed for layout jitter. */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function buildGlyph(seed: string, categoryCount: number): GlyphNode[] {
  // An uncategorized set still needs a mark, and an empty glyph reads as a
  // failed render rather than as "no categories". See MIN_NODES for why the
  // floor is 3 and not 1.
  const count = Math.max(MIN_NODES, Math.min(MAX_NODES, categoryCount))
  let state = hash(seed) || 1

  const next = () => {
    // xorshift32 — same generator each call, so the sequence is a pure
    // function of the seed.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 10000) / 10000
  }

  const nodes: GlyphNode[] = []
  for (let i = 0; i < count; i++) {
    // Nodes are placed around a ring with per-node jitter, which reads as a
    // cluster rather than as a chart. The ring keeps them apart at small
    // sizes; pure random placement collides constantly at n>4.
    const angle = (i / count) * Math.PI * 2 + next() * 0.7
    const radius = 0.22 + next() * 0.2
    nodes.push({
      x: clamp01(0.5 + Math.cos(angle) * radius),
      y: clamp01(0.5 + Math.sin(angle) * radius),
      r: 0.05 + next() * 0.045,
    })
  }
  return nodes
}
