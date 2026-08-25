import { describe, it, expect } from 'vitest'
import { checkTreeInvariants } from '@/lib/klt/invariants'
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

const node = (
  id: string,
  parentKltId: string | null,
  depth: number,
  ancestorIds: string[],
): TreeNodeRow => ({ id, name: id, normalizedName: id, parentKltId, depth, ancestorIds })

const HEALTHY: TreeNodeRow[] = [
  node('f', null, 0, []),
  node('a', 'f', 1, ['f']),
  node('s', 'a', 2, ['f', 'a']),
]

describe('checkTreeInvariants', () => {
  it('passes a healthy tree', () => {
    expect(checkTreeInvariants(HEALTHY)).toEqual([])
  })

  it('catches a depth that does not follow its parent', () => {
    const rows = [...HEALTHY.slice(0, 2), node('s', 'a', 5, ['f', 'a'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('depth_mismatch')
  })

  it('catches an ancestorIds array that does not match a real parent walk', () => {
    // The rollup reads the ARRAY, not the pointers — a stale array silently
    // moves mastery with nothing to notice it.
    const rows = [...HEALTHY.slice(0, 2), node('s', 'a', 2, ['f'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('stale_ancestors')
  })

  it('catches an orphan whose parent does not exist', () => {
    const rows = [node('f', null, 0, []), node('x', 'ghost', 1, ['ghost'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('orphan')
  })

  it('catches a cycle', () => {
    const rows = [node('a', 'b', 1, ['b']), node('b', 'a', 1, ['a'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('cycle')
  })

  it('catches a chain past the depth cap', () => {
    const rows: TreeNodeRow[] = []
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
      rows.push(node(`n${i}`, i === 0 ? null : `n${i - 1}`, i,
        Array.from({ length: i }, (_, j) => `n${j}`)))
    }
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('too_deep')
  })

  it('reports every violation, not just the first', () => {
    const rows = [node('f', null, 0, []), node('a', 'f', 9, ['f']), node('x', 'ghost', 1, [])]
    expect(checkTreeInvariants(rows).length).toBeGreaterThan(1)
  })

  it('names the offending node on every violation', () => {
    const rows = [node('f', null, 0, []), node('a', 'f', 5, ['f'])]
    expect(checkTreeInvariants(rows)[0].kltId).toBe('a')
  })

  it('terminates on a cycle rather than hanging', () => {
    const rows = [node('a', 'b', 1, ['b']), node('b', 'a', 1, ['a'])]
    expect(() => checkTreeInvariants(rows)).not.toThrow()
  })

  it('names the ANCESTOR that is missing, not the parent that exists', () => {
    // c's parent b exists; b's parent 'ghost' does not. Reporting "parent b
    // does not exist" would send an operator to a node that is right there.
    const rows = [node('b', 'ghost', 1, ['ghost']), node('c', 'b', 2, ['ghost', 'b'])]
    const orphans = checkTreeInvariants(rows).filter((v) => v.kind === 'orphan')
    const forC = orphans.find((v) => v.kltId === 'c')
    expect(forC?.detail).toContain('ghost')
    expect(forC?.detail).not.toMatch(/parent b does not exist/)
  })
})
