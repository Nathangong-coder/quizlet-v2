/**
 * Tree-shaped health metrics for the KLT concept tree.
 *
 * PURE — takes plain rows and a per-concept link-count map, returns a
 * structured summary. Prints nothing. `scripts/backfill-klts.ts` is the only
 * thing that knows how to print, and it stays thin as a result: there is no
 * branching logic left in the script worth a test, so this is the one place
 * that is.
 */
import { checkTreeInvariants, type InvariantViolation } from '@/lib/klt/invariants'
import type { TreeNodeRow } from '@/lib/klt/tree'

/** Direct children above which a node has absorbed distinctions it should delegate. */
export const MAX_BRANCHING = 7

export interface TreeHealth {
  violations: InvariantViolation[]
  nodesByDepth: { depth: number; count: number }[]
  unplaced: { id: string; name: string }[]
  overloaded: { id: string; name: string; children: number }[]
  singletonConcepts: number
  linkedConcepts: number
}

/**
 * `linkCounts` is keyed by `kltId`, one entry per concept that has at least
 * one linked key point (e.g. `prisma.klpTopic.groupBy({ by: ['kltId'],
 * _count: true })` reshaped into a map).
 */
export function summarizeTreeHealth(
  rows: TreeNodeRow[],
  linkCounts: Map<string, number>,
): TreeHealth {
  const violations = checkTreeInvariants(rows)

  const byDepth = new Map<number, number>()
  for (const r of rows) byDepth.set(r.depth, (byDepth.get(r.depth) ?? 0) + 1)
  const nodesByDepth = [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, count]) => ({ depth, count }))

  // A root is a node with children and no parent; an unplaced concept has
  // NEITHER. O(n) via a Set, matching the identical predicate in
  // src/lib/klt/place.ts, rather than an O(n^2) nested `.some`.
  const hasChildren = new Set(
    rows.map((r) => r.parentKltId).filter((id): id is string => id !== null),
  )
  const unplaced = rows
    .filter((r) => r.parentKltId === null && !hasChildren.has(r.id))
    .map((r) => ({ id: r.id, name: r.name }))

  const childCount = new Map<string, number>()
  for (const r of rows) {
    if (r.parentKltId) childCount.set(r.parentKltId, (childCount.get(r.parentKltId) ?? 0) + 1)
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const overloaded = [...childCount.entries()]
    .filter(([, count]) => count > MAX_BRANCHING)
    .map(([id, count]) => ({ id, name: byId.get(id)?.name ?? id, children: count }))

  // LEAVES only. A key point normally links to the leaf concept it is
  // chiefly about; a non-leaf node with exactly one direct link is not
  // proliferation, it is a branch that also happens to carry one point of
  // its own (or hasn't had children summarized under it yet). Counting it in
  // would understate how concentrated the leaf layer actually is.
  const leafLinkCounts = [...linkCounts.entries()].filter(([kltId]) => !hasChildren.has(kltId))
  const linkedConcepts = leafLinkCounts.length
  const singletonConcepts = leafLinkCounts.filter(([, count]) => count === 1).length

  return { violations, nodesByDepth, unplaced, overloaded, singletonConcepts, linkedConcepts }
}
