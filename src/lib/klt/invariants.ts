import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

export type ViolationKind =
  | 'depth_mismatch'
  | 'cycle'
  | 'orphan'
  | 'stale_ancestors'
  | 'too_deep'

export interface InvariantViolation {
  kind: ViolationKind
  kltId: string
  detail: string
}

/**
 * Every structural rule the tree must satisfy, checked in one pass.
 *
 * These are the guard, NOT the review: a perfectly-shaped tree of nonsense
 * passes all of them. Semantic correctness is Phase 3's AI audit. What these
 * catch is the class of bug that is invisible in the UI and moves real numbers
 * — a stale `ancestorIds` array, an orphaned subtree, a depth that drifted.
 *
 * Returns EVERY violation rather than throwing on the first, so one run tells
 * an operator the full extent of the damage.
 */
export function checkTreeInvariants(rows: TreeNodeRow[]): InvariantViolation[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: InvariantViolation[] = []

  for (const row of rows) {
    // Walk up, collecting the true ancestor chain and detecting cycles.
    const walked: string[] = []
    const seen = new Set<string>([row.id])
    let cursor = row.parentKltId
    let cyclic = false
    let orphaned = false

    while (cursor !== null) {
      if (seen.has(cursor)) {
        cyclic = true
        break
      }
      const parent = byId.get(cursor)
      if (!parent) {
        orphaned = true
        break
      }
      seen.add(cursor)
      walked.unshift(cursor)
      cursor = parent.parentKltId
    }

    if (cyclic) {
      out.push({ kind: 'cycle', kltId: row.id, detail: 'ancestor chain revisits a node' })
      continue // Every other check below reads the chain, which is meaningless here.
    }
    if (orphaned) {
      out.push({
        kind: 'orphan',
        kltId: row.id,
        detail: `parent ${row.parentKltId} does not exist`,
      })
      continue
    }

    if (row.depth !== walked.length) {
      out.push({
        kind: 'depth_mismatch',
        kltId: row.id,
        detail: `depth ${row.depth} but ${walked.length} ancestors`,
      })
    }
    if (row.ancestorIds.join(',') !== walked.join(',')) {
      out.push({
        kind: 'stale_ancestors',
        kltId: row.id,
        detail: `ancestorIds [${row.ancestorIds}] but walk gives [${walked}]`,
      })
    }
    if (walked.length >= MAX_TREE_DEPTH) {
      out.push({
        kind: 'too_deep',
        kltId: row.id,
        detail: `${walked.length} ancestors exceeds cap ${MAX_TREE_DEPTH}`,
      })
    }
  }

  return out
}
