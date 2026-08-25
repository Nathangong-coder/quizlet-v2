import { describe, it, expect } from 'vitest'
import { summarizeTreeHealth, MAX_BRANCHING } from '@/lib/klt/health'
import type { TreeNodeRow } from '@/lib/klt/tree'

const node = (
  id: string,
  parentKltId: string | null,
  depth: number,
  ancestorIds: string[],
  name: string = id,
): TreeNodeRow => ({ id, name, normalizedName: name.toLowerCase(), parentKltId, depth, ancestorIds })

describe('summarizeTreeHealth', () => {
  it('returns empty everything for an empty tree, without throwing', () => {
    expect(() => summarizeTreeHealth([], new Map())).not.toThrow()
    expect(summarizeTreeHealth([], new Map())).toEqual({
      violations: [],
      nodesByDepth: [],
      unplaced: [],
      overloaded: [],
      singletonConcepts: 0,
      linkedConcepts: 0,
    })
  })

  it('flags no violations or warnings on a small healthy tree', () => {
    const rows = [
      node('root', null, 0, [], 'finance'),
      node('child', 'root', 1, ['root'], 'accounting'),
    ]
    const health = summarizeTreeHealth(rows, new Map([['child', 2]]))
    expect(health.violations).toEqual([])
    expect(health.unplaced).toEqual([])
    expect(health.overloaded).toEqual([])
  })

  it('surfaces a real structural violation from checkTreeInvariants', () => {
    // 'child' claims depth 5 but only has one real ancestor -> depth_mismatch.
    const rows = [
      node('root', null, 0, [], 'finance'),
      node('child', 'root', 5, ['root'], 'accounting'),
    ]
    const health = summarizeTreeHealth(rows, new Map())
    expect(health.violations).toHaveLength(1)
    expect(health.violations[0].kind).toBe('depth_mismatch')
  })

  it('buckets nodes by depth', () => {
    const rows = [
      node('a', null, 0, [], 'a'),
      node('b', 'a', 1, ['a'], 'b'),
      node('c', 'a', 1, ['a'], 'c'),
    ]
    const health = summarizeTreeHealth(rows, new Map())
    expect(health.nodesByDepth).toEqual([
      { depth: 0, count: 1 },
      { depth: 1, count: 2 },
    ])
  })

  it('flags an unplaced concept but not a genuine root', () => {
    const rows = [
      node('root', null, 0, [], 'finance'), // no parent, but HAS a child -> root
      node('child', 'root', 1, ['root'], 'accounting'),
      node('orphan', null, 0, [], 'derivatives'), // no parent, no children -> unplaced
    ]
    const health = summarizeTreeHealth(rows, new Map())
    expect(health.unplaced).toEqual([{ id: 'orphan', name: 'derivatives' }])
  })

  it('does not flag a node exactly at MAX_BRANCHING, but does one over it', () => {
    const parent = node('p', null, 0, [], 'parent')

    const atLimit = Array.from({ length: MAX_BRANCHING }, (_, i) =>
      node(`at-${i}`, 'p', 1, ['p'], `c${i}`),
    )
    const healthAtLimit = summarizeTreeHealth([parent, ...atLimit], new Map())
    expect(healthAtLimit.overloaded).toEqual([])

    const overLimit = Array.from({ length: MAX_BRANCHING + 1 }, (_, i) =>
      node(`over-${i}`, 'p', 1, ['p'], `c${i}`),
    )
    const healthOverLimit = summarizeTreeHealth([parent, ...overLimit], new Map())
    expect(healthOverLimit.overloaded).toEqual([
      { id: 'p', name: 'parent', children: MAX_BRANCHING + 1 },
    ])
  })

  it('counts singletons among LEAVES only, excluding a linked non-leaf', () => {
    const rows = [
      node('root', null, 0, [], 'finance'),
      node('leaf1', 'root', 1, ['root'], 'npv'),
      node('leaf2', 'root', 1, ['root'], 'irr'),
    ]
    // 'root' has children, so it is NOT a leaf -- its one link must not count
    // toward either the denominator or the singleton count.
    const linkCounts = new Map([
      ['root', 1],
      ['leaf1', 1],
      ['leaf2', 3],
    ])
    const health = summarizeTreeHealth(rows, linkCounts)
    expect(health.linkedConcepts).toBe(2) // leaf1, leaf2 only
    expect(health.singletonConcepts).toBe(1) // leaf1 only
  })
})
