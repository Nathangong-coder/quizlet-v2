import { describe, it, expect } from 'vitest'
import {
  renderTreeForPrompt,
  wouldCycle,
  computeSubtreeUpdates,
  MAX_TREE_DEPTH,
  type TreeNodeRow,
} from '@/lib/klt/tree'

const node = (
  id: string,
  name: string,
  parentKltId: string | null,
  depth: number,
  ancestorIds: string[],
): TreeNodeRow => ({ id, name, normalizedName: name, parentKltId, depth, ancestorIds })

//  finance
//  └── accounting
//      └── statements
//          └── cash flow
const TREE: TreeNodeRow[] = [
  node('f', 'finance', null, 0, []),
  node('a', 'accounting', 'f', 1, ['f']),
  node('s', 'statements', 'a', 2, ['f', 'a']),
  node('c', 'cash flow', 's', 3, ['f', 'a', 's']),
]
const byId = new Map(TREE.map((n) => [n.id, n]))

describe('renderTreeForPrompt', () => {
  it('renders one indented line per node, parents before children', () => {
    expect(renderTreeForPrompt(TREE)).toBe(
      ['finance', '  accounting', '    statements', '      cash flow'].join('\n'),
    )
  })

  it('renders an empty tree as an empty string', () => {
    expect(renderTreeForPrompt([])).toBe('')
  })

  it('renders multiple roots', () => {
    const out = renderTreeForPrompt([...TREE, node('b', 'biology', null, 0, [])])
    expect(out).toContain('finance')
    expect(out).toContain('biology')
  })
})

describe('wouldCycle', () => {
  it('detects placing a node under its own descendant', () => {
    // Moving `accounting` under `cash flow` would make accounting its own ancestor.
    expect(wouldCycle('a', 'c', byId)).toBe(true)
  })

  it('detects placing a node under itself', () => {
    expect(wouldCycle('a', 'a', byId)).toBe(true)
  })

  it('allows a legitimate move', () => {
    expect(wouldCycle('c', 'a', byId)).toBe(false)
  })
})

describe('computeSubtreeUpdates', () => {
  it('recomputes depth and ancestors for the moved node AND its subtree', () => {
    // Move `statements` from under `accounting` to directly under `finance`.
    const updates = computeSubtreeUpdates('s', 'f', TREE)
    expect(updates).toEqual([
      { id: 's', depth: 1, ancestorIds: ['f'] },
      { id: 'c', depth: 2, ancestorIds: ['f', 's'] },
    ])
  })

  it('handles promotion to a root', () => {
    const updates = computeSubtreeUpdates('s', null, TREE)
    expect(updates).toEqual([
      { id: 's', depth: 0, ancestorIds: [] },
      { id: 'c', depth: 1, ancestorIds: ['s'] },
    ])
  })

  it('returns an empty list when nothing actually changes', () => {
    expect(computeSubtreeUpdates('c', 's', TREE)).toEqual([])
  })

  it(`refuses a move that would push the subtree past depth ${MAX_TREE_DEPTH}`, () => {
    // A chain already at the cap cannot be pushed deeper.
    const deep: TreeNodeRow[] = []
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
      deep.push(node(`n${i}`, `n${i}`, i === 0 ? null : `n${i - 1}`, i,
        Array.from({ length: i }, (_, j) => `n${j}`)))
    }
    expect(() => computeSubtreeUpdates('n1', `n${MAX_TREE_DEPTH}`, deep)).toThrow(/depth/i)
  })
})
