import { MAX_TREE_DEPTH, type SetNodeRow } from '@/lib/klt/tree'

export type ViolationKind =
  | 'depth_mismatch'
  | 'cycle'
  | 'orphan'
  | 'stale_ancestors'
  | 'too_deep'
  | 'parent_not_in_set'

export interface InvariantViolation {
  kind: ViolationKind
  /** The concept — what an operator recognizes and would go fix in the tree. */
  kltId: string
  /** The SetKltNode row — what a write would target. */
  nodeId: string
  detail: string
}

/**
 * Every structural rule ONE SET's tree must satisfy, checked in one pass.
 *
 * Takes rows already scoped to a single set — this function never sees a
 * `setId` and cannot verify what it is not given; scoping is the caller's
 * job. The lookup keys on `kltId` (the concept `parentKltId`/`ancestorIds`
 * point at), NOT `id` (the `SetKltNode` row) — `SetKltNode.parentKltId`
 * deliberately carries no foreign key (an FK would have to point at `Klt`,
 * which would wrongly permit a parent with no node in this set), so this
 * checker, keyed correctly, is the only thing standing in for it.
 *
 * These are the guard, NOT the review: a perfectly-shaped tree of nonsense
 * passes all of them. Semantic correctness is Phase 3's AI audit. What these
 * catch is the class of bug that is invisible in the UI and moves real numbers
 * — a stale `ancestorIds` array, an orphaned subtree, a depth that drifted.
 *
 * Returns EVERY violation rather than throwing on the first, so one run tells
 * an operator the full extent of the damage.
 */
export function checkTreeInvariants(rows: SetNodeRow[]): InvariantViolation[] {
  const byKltId = new Map(rows.map((r) => [r.kltId, r]))
  const out: InvariantViolation[] = []

  for (const row of rows) {
    // The foreign key SetKltNode.parentKltId cannot declare: a node's own
    // parent must itself have a SetKltNode in this set. Checked first and
    // unconditionally — every other check below assumes the direct parent
    // (if any) actually resolves, and narrows `orphan` to mean the break is
    // further up the chain than this.
    if (row.parentKltId !== null && !byKltId.has(row.parentKltId)) {
      out.push({
        kind: 'parent_not_in_set',
        kltId: row.kltId,
        nodeId: row.id,
        detail: `parent ${row.parentKltId} has no SetKltNode in this set`,
      })
      continue // Nothing else here is meaningful without a real direct parent.
    }

    // Walk up, collecting the true ancestor chain and detecting cycles.
    const walked: string[] = []
    const seen = new Set<string>([row.kltId])
    let cursor = row.parentKltId
    let cyclic = false
    let orphaned = false
    let missingId: string | null = null

    while (cursor !== null) {
      if (seen.has(cursor)) {
        cyclic = true
        break
      }
      const parent = byKltId.get(cursor)
      if (!parent) {
        orphaned = true
        missingId = cursor
        break
      }
      seen.add(cursor)
      walked.unshift(cursor)
      cursor = parent.parentKltId
    }

    if (cyclic) {
      out.push({
        kind: 'cycle',
        kltId: row.kltId,
        nodeId: row.id,
        detail: 'ancestor chain revisits a node',
      })
      continue // Every other check below reads the chain, which is meaningless here.
    }
    if (orphaned) {
      // The direct parent was already confirmed present above, so a miss here
      // is always further up the chain — an ancestor, never the parent itself.
      out.push({
        kind: 'orphan',
        kltId: row.kltId,
        nodeId: row.id,
        detail: `ancestor ${missingId} does not exist (reached via parent ${row.parentKltId})`,
      })
      continue
    }

    if (row.depth !== walked.length) {
      out.push({
        kind: 'depth_mismatch',
        kltId: row.kltId,
        nodeId: row.id,
        detail: `depth ${row.depth} but ${walked.length} ancestors`,
      })
    }
    if (row.ancestorIds.join(',') !== walked.join(',')) {
      out.push({
        kind: 'stale_ancestors',
        kltId: row.kltId,
        nodeId: row.id,
        detail: `ancestorIds [${row.ancestorIds}] but walk gives [${walked}]`,
      })
    }
    if (walked.length >= MAX_TREE_DEPTH) {
      out.push({
        kind: 'too_deep',
        kltId: row.kltId,
        nodeId: row.id,
        detail: `${walked.length} ancestors reaches or exceeds cap ${MAX_TREE_DEPTH}`,
      })
    }
  }

  return out
}
