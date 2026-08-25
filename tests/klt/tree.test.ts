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

  it('orders siblings alphabetically, so prompt output is stable across runs', () => {
    // Inserted in reverse alphabetical order on purpose: without the sort this
    // renders in insertion order and the assertion fails. The prompt built from
    // this string is cached, so unstable ordering is churn nobody can see.
    const rows: TreeNodeRow[] = [
      node('r', 'root', null, 0, []),
      node('z', 'zebra', 'r', 1, ['r']),
      node('m', 'mango', 'r', 1, ['r']),
      node('a', 'apple', 'r', 1, ['r']),
    ]
    expect(renderTreeForPrompt(rows)).toBe(
      ['root', '  apple', '  mango', '  zebra'].join('\n'),
    )
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

  it('terminates on an ALREADY cyclic map instead of looping forever', () => {
    // Not reachable through the writers, but a corrupted row or a bad manual
    // edit would produce it — and without the `seen` guard this call never
    // returns, hanging whatever requested it rather than failing.
    const a = node('a', 'a', 'b', 1, ['b'])
    const b = node('b', 'b', 'a', 1, ['a'])
    const corrupt = new Map([['a', a], ['b', b]])
    expect(wouldCycle('zzz', 'a', corrupt)).toBe(true)
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
    // A separate subtree moved under a chain that is already at depth 7: the
    // moved node would land at 8. Deliberately NOT a cycle — `m0` is nowhere
    // in `n7`'s ancestry — so this exercises the depth guard and only that.
    const rows: TreeNodeRow[] = []
    for (let i = 0; i <= MAX_TREE_DEPTH - 1; i++) {
      rows.push(node(`n${i}`, `n${i}`, i === 0 ? null : `n${i - 1}`, i,
        Array.from({ length: i }, (_, j) => `n${j}`)))
    }
    rows.push(node('m0', 'm0', null, 0, []))
    rows.push(node('m1', 'm1', 'm0', 1, ['m0']))
    expect(() => computeSubtreeUpdates('m0', `n${MAX_TREE_DEPTH - 1}`, rows)).toThrow(/depth/i)
  })

  it('reports a CYCLE, not a depth error, when moving under a descendant', () => {
    // The two guards must stay distinguishable: a cycle makes the subtree walk
    // non-terminating, so it has to be named as a cycle rather than mislabelled
    // as depth by a check that happens to fire first.
    const rows: TreeNodeRow[] = []
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
      rows.push(node(`n${i}`, `n${i}`, i === 0 ? null : `n${i - 1}`, i,
        Array.from({ length: i }, (_, j) => `n${j}`)))
    }
    expect(() => computeSubtreeUpdates('n1', `n${MAX_TREE_DEPTH}`, rows)).toThrow(/cycle/i)
  })
})
