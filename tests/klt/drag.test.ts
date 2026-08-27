import { describe, it, expect } from 'vitest'
import { evaluateDrop } from '@/lib/klt/drag'
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

function node(
  kltId: string,
  parentKltId: string | null,
  ancestorIds: string[],
  name = kltId,
): TreeNodeRow {
  return {
    id: `row-${kltId}`,
    kltId,
    name,
    normalizedName: name.toLowerCase(),
    parentKltId,
    depth: ancestorIds.length,
    ancestorIds,
  }
}

/** `finance > accounting > {income statement, balance sheet}`, plus a lone `valuation` root. */
function tree(): TreeNodeRow[] {
  return [
    node('finance', null, []),
    node('acct', 'finance', ['finance'], 'accounting'),
    node('is', 'acct', ['finance', 'acct'], 'income statement'),
    node('bs', 'acct', ['finance', 'acct'], 'balance sheet'),
    node('val', null, [], 'valuation'),
  ]
}

describe('evaluateDrop', () => {
  it('allows a leaf onto another branch and applies without a confirm', () => {
    const v = evaluateDrop('is', 'val', tree())
    expect(v).toEqual({ ok: true, kind: 'reparent', movedCount: 1, needsConfirm: false })
  })

  it('asks for confirmation when the drag carries descendants, and says how many', () => {
    // `accounting` brings both its children — three nodes change position, so
    // the drop stops to say so instead of silently reorganising a branch.
    const v = evaluateDrop('acct', 'val', tree())
    expect(v).toMatchObject({ ok: true, kind: 'reparent', movedCount: 3, needsConfirm: true })
  })

  it('refuses dropping a node on itself', () => {
    const v = evaluateDrop('acct', 'acct', tree())
    expect(v.ok).toBe(false)
  })

  it('refuses dropping a node onto its own descendant', () => {
    // The cycle case. Allowing it detaches the whole subtree from the tree
    // and makes the rollup query non-terminating.
    const v = evaluateDrop('finance', 'is', tree())
    expect(v).toEqual({ ok: false, reason: '“income statement” is already inside “finance”' })
  })

  it('refuses a drop onto the parent it already has', () => {
    const v = evaluateDrop('is', 'acct', tree())
    expect(v).toEqual({ ok: false, reason: 'Already under “accounting”' })
  })

  it('refuses dropping an existing root onto the canvas', () => {
    const v = evaluateDrop('val', null, tree())
    expect(v).toEqual({ ok: false, reason: 'Already a root concept' })
  })

  it('allows dropping a nested node onto the canvas to make it a root', () => {
    const v = evaluateDrop('is', null, tree())
    expect(v).toMatchObject({ ok: true, kind: 'reparent', movedCount: 1 })
  })

  it('treats a concept with no node as a placement, not a move', () => {
    const v = evaluateDrop('unplaced-concept', 'acct', tree())
    expect(v).toEqual({ ok: true, kind: 'place', movedCount: 1, needsConfirm: false })
  })

  it('places an unplaced concept at the canvas root too', () => {
    expect(evaluateDrop('unplaced-concept', null, tree())).toMatchObject({
      ok: true,
      kind: 'place',
    })
  })

  it('refuses a target that is not in this set', () => {
    const v = evaluateDrop('is', 'somewhere-else', tree())
    expect(v).toEqual({ ok: false, reason: 'That concept is not in this set' })
  })

  it('refuses a move that would push a descendant past the depth cap', () => {
    // Refused WHOLE, matching `computeSubtreeUpdates` — the server would
    // refuse it anyway, so the canvas must not light the target up as legal.
    // A chain filling every level up to the cap...
    const chain: TreeNodeRow[] = []
    const ancestors: string[] = []
    for (let d = 0; d < MAX_TREE_DEPTH - 1; d += 1) {
      chain.push(node(`d${d}`, d === 0 ? null : `d${d - 1}`, [...ancestors]))
      ancestors.push(`d${d}`)
    }
    // ...and a two-deep subtree dropped onto its deepest node: the PARENT
    // would still fit, its child would not, so the whole move is refused.
    chain.push(node('x', null, []))
    chain.push(node('y', 'x', ['x']))
    const deepest = `d${MAX_TREE_DEPTH - 2}`
    const v = evaluateDrop('x', deepest, chain)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/max depth/i)
  })

  it('refuses placing an unplaced concept under a node already at the cap', () => {
    const deep = [node('deep', null, Array.from({ length: MAX_TREE_DEPTH - 1 }, (_, i) => `a${i}`))]
    const v = evaluateDrop('fresh', 'deep', deep)
    expect(v.ok).toBe(false)
  })
})
