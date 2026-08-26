import { describe, it, expect } from 'vitest'
import { checkTreeInvariants } from '@/lib/klt/invariants'
import { MAX_TREE_DEPTH, type SetNodeRow } from '@/lib/klt/tree'

// `id` (the SetKltNode row) is deliberately DIFFERENT from `kltId` (the
// concept) in every fixture below — a checker that accidentally keyed its
// lookup map on `id` instead of `kltId` would still pass fixtures where the
// two coincide, which defeats the point of this test file.
const node = (
  kltId: string,
  parentKltId: string | null,
  depth: number,
  ancestorIds: string[],
): SetNodeRow => ({ id: `node-${kltId}`, kltId, parentKltId, depth, ancestorIds })

const HEALTHY: SetNodeRow[] = [
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

  it("catches a node whose OWN parentKltId has no node in this set (no FK exists to catch it)", () => {
    const rows = [node('x', 'ghost', 1, ['ghost'])]
    const violations = checkTreeInvariants(rows)
    expect(violations.map((v) => v.kind)).toContain('parent_not_in_set')
    const v = violations.find((v) => v.kind === 'parent_not_in_set')
    expect(v?.kltId).toBe('x')
    expect(v?.nodeId).toBe('node-x')
  })

  it('narrows orphan to a break FURTHER UP the chain, not the direct parent', () => {
    // b's own parent 'ghost' is missing -> parent_not_in_set for b.
    // c's direct parent 'b' IS present; the break is at b's parent -> orphan for c.
    const rows = [node('b', 'ghost', 1, ['ghost']), node('c', 'b', 2, ['ghost', 'b'])]
    const violations = checkTreeInvariants(rows)
    expect(violations.find((v) => v.kltId === 'b')?.kind).toBe('parent_not_in_set')
    expect(violations.find((v) => v.kltId === 'c')?.kind).toBe('orphan')
  })

  it('catches a cycle', () => {
    const rows = [node('a', 'b', 1, ['b']), node('b', 'a', 1, ['a'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('cycle')
  })

  it('catches a chain past the depth cap', () => {
    const rows: SetNodeRow[] = []
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
      rows.push(
        node(
          `n${i}`,
          i === 0 ? null : `n${i - 1}`,
          i,
          Array.from({ length: i }, (_, j) => `n${j}`),
        ),
      )
    }
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('too_deep')
  })

  it('reports every violation, not just the first', () => {
    const rows = [node('f', null, 0, []), node('a', 'f', 9, ['f']), node('x', 'ghost', 1, [])]
    expect(checkTreeInvariants(rows).length).toBeGreaterThan(1)
  })

  it('names the offending CONCEPT (kltId) and the SetKltNode row (nodeId) on every violation', () => {
    const rows = [node('f', null, 0, []), node('a', 'f', 5, ['f'])]
    const v = checkTreeInvariants(rows)[0]
    expect(v.kltId).toBe('a')
    expect(v.nodeId).toBe('node-a')
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
