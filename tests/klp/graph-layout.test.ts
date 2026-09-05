import { describe, it, expect } from 'vitest'
import {
  computeLayers,
  layoutKlpGraph,
  edgeGeometry,
  RELATION_STYLE,
  NODE_WIDTH,
  clampScale,
  fitScale,
  applyOverrides,
  graphExtent,
  MIN_SCALE,
  MAX_SCALE,
} from '@/lib/klp/graph-layout'
import { RELATION_TYPES, type RelationEdge } from '@/lib/klp/relations'

const causes = (from: number, to: number): RelationEdge => ({ from, to, type: 'causes' })

describe('computeLayers', () => {
  /** The worked example's shape: EBIT -> net income -> CFO, with a second feed into CFO. */
  it('puts each node one column past the deepest thing feeding it', () => {
    const layers = computeLayers(4, [causes(0, 1), causes(1, 2), causes(3, 2)])
    expect(layers[0]).toBe(0)
    expect(layers[1]).toBe(1)
    expect(layers[2]).toBe(2)
    expect(layers[3]).toBe(0)
  })

  it('leaves every node in column 0 when nothing is related', () => {
    expect(computeLayers(3, [])).toEqual([0, 0, 0])
  })

  /**
   * `confused_with` asserts similarity, not dependency. Letting it push a node
   * rightwards would draw a derivation the data never claimed.
   */
  it('ignores symmetric edges, which carry no direction', () => {
    expect(computeLayers(2, [{ from: 0, to: 1, type: 'confused_with' }])).toEqual([0, 0])
  })

  /**
   * Cycles are pruned before persistence, but this must not be the code that
   * discovers one by never returning — a hanging layout takes the page with it.
   */
  it('terminates on a cycle instead of looping forever', () => {
    const layers = computeLayers(3, [causes(0, 1), causes(1, 2), causes(2, 0)])
    expect(layers).toHaveLength(3)
    expect(layers.every((l) => Number.isFinite(l))).toBe(true)
  })

  it('ignores out-of-range endpoints and self-loops', () => {
    expect(computeLayers(2, [causes(0, 99), causes(1, 1)])).toEqual([0, 0])
  })
})

describe('layoutKlpGraph', () => {
  it('is empty for a card with no key points', () => {
    expect(layoutKlpGraph(0, [])).toEqual({ nodes: [], width: 0, height: 0, layerCount: 0 })
  })

  it('stacks unrelated nodes in one column', () => {
    const { nodes, layerCount } = layoutKlpGraph(3, [])
    expect(layerCount).toBe(1)
    expect(nodes.map((n) => n.slot)).toEqual([0, 1, 2])
    expect(new Set(nodes.map((n) => n.x)).size).toBe(1)
    expect(new Set(nodes.map((n) => n.y)).size).toBe(3)
  })

  /**
   * The list beside the graph is numbered K1..Kn in input order, so a reader
   * scanning down the list and across the graph meets them in the same
   * sequence. Sorting columns by edge count or weight would make a prettier
   * picture and break that correspondence.
   */
  it('keeps nodes in their original order within a column', () => {
    const { nodes } = layoutKlpGraph(4, [causes(0, 3)])
    const column0 = nodes.filter((n) => n.layer === 0).map((n) => n.index)
    expect(column0).toEqual([0, 1, 2])
  })

  it('grows wide enough for the deepest chain', () => {
    const chain = layoutKlpGraph(3, [causes(0, 1), causes(1, 2)])
    const flat = layoutKlpGraph(3, [])
    expect(chain.layerCount).toBe(3)
    expect(chain.width).toBeGreaterThan(flat.width)
    expect(chain.height).toBeLessThan(flat.height)
  })

  it('gives every node a positive, finite position', () => {
    for (const n of layoutKlpGraph(7, [causes(0, 1), causes(1, 3), causes(2, 3)]).nodes) {
      expect(Number.isFinite(n.x) && n.x >= 0).toBe(true)
      expect(Number.isFinite(n.y) && n.y >= 0).toBe(true)
    }
  })
})

describe('edgeGeometry', () => {
  const { nodes } = layoutKlpGraph(3, [causes(0, 1)])

  it('leaves the right face and enters the left face going forward', () => {
    const g = edgeGeometry(nodes[0], nodes[1])
    expect(g.path.startsWith(`M ${nodes[0].x + NODE_WIDTH}`)).toBe(true)
    expect(g.path).toContain('C')
  })

  /**
   * A same-column edge drawn face-to-face would cut straight through its own
   * source box. That is the `confused_with` case, whose endpoints are usually
   * siblings in one column, so it has to route around instead.
   */
  it('routes under both boxes for a same-column edge', () => {
    const flat = layoutKlpGraph(2, []).nodes;
    const g = edgeGeometry(flat[0], flat[1])
    expect(g.labelY).toBeGreaterThan(Math.max(flat[0].y, flat[1].y))
  })

  it('places a label somewhere finite for every pair', () => {
    for (const a of nodes) {
      for (const b of nodes) {
        const g = edgeGeometry(a, b)
        expect(Number.isFinite(g.labelX) && Number.isFinite(g.labelY)).toBe(true)
      }
    }
  })
})

describe('RELATION_STYLE', () => {
  /** An unstyled type would render as an indistinguishable solid line. */
  it('styles every type in the vocabulary', () => {
    for (const type of RELATION_TYPES) expect(RELATION_STYLE[type]).toBeDefined()
  })

  it('separates confusion edges from derivation edges by tone', () => {
    expect(RELATION_STYLE.causes.tone).toBe('derivation')
    expect(RELATION_STYLE.confused_with.tone).toBe('confusion')
  })

  it('gives each derivation type its own dash pattern, so they are distinguishable', () => {
    const derivation = ['causes', 'requires', 'precedes', 'applies_within'].map((t) => RELATION_STYLE[t].dash)
    expect(new Set(derivation).size).toBe(derivation.length)
  })
})

describe('zoom, drag and fit', () => {
  it('clamps zoom to a readable range', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(1.4)).toBe(1.4)
    expect(clampScale(Number.NaN)).toBe(1)
  })

  /**
   * Only SHRINKING is automatic. Blowing a three-box graph up until it fills a
   * wide pane is not a fit, it is a distortion — and overflow is the only
   * problem the reader cannot solve by looking.
   */
  it('shrinks to fit but never enlarges past natural size', () => {
    expect(fitScale(1000, 400, 500, 400)).toBeCloseTo(0.5)
    expect(fitScale(200, 100, 2000, 2000)).toBe(1)
  })

  it('fits the tighter of the two axes', () => {
    expect(fitScale(1000, 1000, 500, 800)).toBeCloseTo(0.5)
    expect(fitScale(1000, 1000, 800, 500)).toBeCloseTo(0.5)
  })

  /**
   * A graph too large to fit even at the floor is left overflowing to be
   * panned, rather than shrunk into an unreadable smear. Below MIN_SCALE the
   * labels cannot be read, so "fitting" further shows everything and tells
   * you nothing.
   */
  it('stops shrinking at the readable floor rather than fitting at any cost', () => {
    expect(fitScale(10000, 10000, 500, 250)).toBe(MIN_SCALE)
  })

  it('returns 1 rather than NaN or Infinity for a degenerate container', () => {
    expect(fitScale(100, 100, 0, 0)).toBe(1)
    expect(fitScale(0, 0, 500, 500)).toBe(1)
  })
})

describe('applyOverrides', () => {
  const base = layoutKlpGraph(3, []).nodes

  /**
   * Overrides stay SEPARATE from the computed layout, so recomputing the layout
   * does not need to know what the reader dragged, and "reset" is deleting a
   * map rather than recomputing anything.
   */
  it('moves only the dragged node and leaves the rest alone', () => {
    const moved = applyOverrides(base, { 1: { x: 500, y: 300 } })
    expect(moved[1]).toMatchObject({ x: 500, y: 300 })
    expect(moved[0]).toEqual(base[0])
    expect(moved[2]).toEqual(base[2])
  })

  it('returns the same array when nothing has been dragged', () => {
    expect(applyOverrides(base, {})).toBe(base)
  })
})

describe('graphExtent', () => {
  /** Otherwise dragging a box to the right simply hides it off-canvas. */
  it('grows to include a node dragged beyond the original bounds', () => {
    const base = layoutKlpGraph(2, []).nodes
    const before = graphExtent(base)
    const after = graphExtent(applyOverrides(base, { 0: { x: 2000, y: 1200 } }))
    expect(after.width).toBeGreaterThan(before.width)
    expect(after.height).toBeGreaterThan(before.height)
  })

  it('is zero for an empty graph rather than -Infinity', () => {
    expect(graphExtent([])).toEqual({ width: 0, height: 0 })
  })
})
