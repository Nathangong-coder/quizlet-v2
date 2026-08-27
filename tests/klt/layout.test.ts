import { describe, it, expect } from 'vitest'
import { layoutTree, elbowPath, LAYOUT_DEFAULTS, type LayoutNode } from '@/lib/klt/layout'

/** `finance > {accounting > {IS, BS}, valuation > {DCF, WACC}}` — the shape in the design. */
function sampleTree(): LayoutNode[] {
  return [
    { kltId: 'finance', parentKltId: null, name: 'finance' },
    { kltId: 'acct', parentKltId: 'finance', name: 'accounting' },
    { kltId: 'val', parentKltId: 'finance', name: 'valuation' },
    { kltId: 'is', parentKltId: 'acct', name: 'income statement' },
    { kltId: 'bs', parentKltId: 'acct', name: 'balance sheet' },
    { kltId: 'dcf', parentKltId: 'val', name: 'DCF' },
    { kltId: 'wacc', parentKltId: 'val', name: 'WACC' },
  ]
}

const SLOT = LAYOUT_DEFAULTS.nodeWidth + LAYOUT_DEFAULTS.hGap
const ROW = LAYOUT_DEFAULTS.nodeHeight + LAYOUT_DEFAULTS.vGap

describe('layoutTree', () => {
  it('places every node exactly once', () => {
    const out = layoutTree(sampleTree())
    expect(out.nodes).toHaveLength(7)
    expect(new Set(out.nodes.map((n) => n.kltId)).size).toBe(7)
  })

  it('puts each node on the row for its depth', () => {
    const out = layoutTree(sampleTree())
    expect(out.byKltId.get('finance')!.y).toBe(0)
    expect(out.byKltId.get('acct')!.y).toBe(ROW)
    expect(out.byKltId.get('is')!.y).toBe(2 * ROW)
  })

  it('centres a parent over its own children', () => {
    const out = layoutTree(sampleTree())
    for (const [parent, kids] of [
      ['acct', ['is', 'bs']],
      ['val', ['dcf', 'wacc']],
      ['finance', ['acct', 'val']],
    ] as const) {
      const xs = kids.map((k) => out.byKltId.get(k)!.x)
      const expected = (Math.min(...xs) + Math.max(...xs)) / 2
      expect(out.byKltId.get(parent)!.x).toBeCloseTo(expected, 1)
    }
  })

  it('never overlaps two boxes on the same row', () => {
    // The property a reader notices the instant it breaks, so it is asserted
    // over EVERY pair on every row rather than spot-checked.
    const out = layoutTree(sampleTree())
    const byRow = new Map<number, number[]>()
    for (const n of out.nodes) {
      const row = byRow.get(n.depth)
      if (row) row.push(n.x)
      else byRow.set(n.depth, [n.x])
    }
    for (const xs of byRow.values()) {
      const sorted = [...xs].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(LAYOUT_DEFAULTS.nodeWidth)
      }
    }
  })

  it('gives leaves consecutive slots, left to right, in sibling-name order', () => {
    const out = layoutTree(sampleTree())
    // Siblings sort by name: accounting < valuation, balance sheet < income
    // statement, DCF < WACC.
    const leafOrder = ['bs', 'is', 'dcf', 'wacc']
    leafOrder.forEach((kltId, i) => {
      expect(out.byKltId.get(kltId)!.x).toBeCloseTo(i * SLOT + LAYOUT_DEFAULTS.nodeWidth / 2, 1)
    })
  })

  it('draws one edge per parent-child pair and none for a root', () => {
    const out = layoutTree(sampleTree())
    expect(out.edges).toHaveLength(6)
    expect(out.edges.every((e) => e.path.startsWith('M '))).toBe(true)
    expect(out.edges.some((e) => e.childKltId === 'finance')).toBe(false)
  })

  it('treats a node whose parent is not visible as a root', () => {
    // This IS the filter/collapse behaviour: the caller passes only visible
    // nodes, and a node whose ancestors were filtered out must still appear.
    const out = layoutTree([
      { kltId: 'is', parentKltId: 'acct', name: 'income statement' },
      { kltId: 'bs', parentKltId: 'acct', name: 'balance sheet' },
    ])
    expect(out.nodes.map((n) => n.depth)).toEqual([0, 0])
    expect(out.edges).toHaveLength(0)
  })

  it('lays out several roots side by side without overlapping', () => {
    const out = layoutTree([
      { kltId: 'a', parentKltId: null, name: 'alpha' },
      { kltId: 'b', parentKltId: null, name: 'beta' },
    ])
    expect(Math.abs(out.byKltId.get('a')!.x - out.byKltId.get('b')!.x)).toBeGreaterThanOrEqual(
      LAYOUT_DEFAULTS.nodeWidth,
    )
  })

  it('reports an extent that contains every node', () => {
    const out = layoutTree(sampleTree())
    for (const n of out.nodes) {
      expect(n.x + LAYOUT_DEFAULTS.nodeWidth / 2).toBeLessThanOrEqual(out.width + 0.01)
      expect(n.y + LAYOUT_DEFAULTS.nodeHeight).toBeLessThanOrEqual(out.height + 0.01)
    }
  })

  it('returns an empty layout for no nodes, not a zero-sized one with artifacts', () => {
    const out = layoutTree([])
    expect(out.nodes).toHaveLength(0)
    expect(out.edges).toHaveLength(0)
    expect(out.width).toBe(0)
    expect(out.height).toBe(0)
  })

  it('terminates on a parent cycle instead of recursing forever', () => {
    // Unreachable through the actions (`wouldCycle` gates every write), but
    // the canvas must not be the component that hangs the tab if it happens.
    const out = layoutTree([
      { kltId: 'a', parentKltId: 'b', name: 'a' },
      { kltId: 'b', parentKltId: 'a', name: 'b' },
    ])
    expect(out.nodes.length).toBeGreaterThan(0)
  })

  it('honours custom sizing', () => {
    const out = layoutTree(sampleTree(), { nodeHeight: 10, vGap: 10 })
    expect(out.byKltId.get('acct')!.y).toBe(20)
  })
})

describe('elbowPath', () => {
  it('is a straight line when the two nodes are vertically aligned', () => {
    expect(elbowPath(100, 0, 100, 50, 12)).toBe('M 100 0 L 100 50')
  })

  it('turns through the midpoint between the two levels', () => {
    const d = elbowPath(0, 0, 100, 100, 10)
    expect(d).toContain('50') // the mid-Y both corners sit on
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d.endsWith('L 100 100')).toBe(true)
  })

  it('shrinks the corner radius rather than drawing an arc wider than the gap', () => {
    const d = elbowPath(0, 0, 4, 100, 40)
    // Radius is capped at half the horizontal travel (2), so the first corner
    // starts at x=0 and ends at x=2 — never overshooting the target.
    expect(d).toContain('Q 0 50 2 50')
  })
})
