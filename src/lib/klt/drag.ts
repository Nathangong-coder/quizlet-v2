/**
 * What a drop would do — decided before it happens.
 *
 * The canvas asks this on every drag-over (to light a target up or refuse it)
 * and again on the drop (to choose the action and decide whether to confirm).
 * It is pure so both questions get the SAME answer: a target that highlighted
 * as legal cannot then fail on release, which is the bug users report as "it
 * just didn't do anything".
 *
 * This decides only what is STRUCTURALLY possible. Permission is the server's
 * job — every action re-checks `requireSetKltAccess` and re-runs the same
 * arithmetic — so a tampered client gets a refusal, not a write.
 */
import { computeSubtreeUpdates, MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

/**
 * What is currently being dragged. Held in React state rather than read from
 * `DataTransfer`, because `getData` returns an empty string during `dragover`
 * in every major browser — and `dragover` is exactly when the canvas has to
 * decide whether to light a target up.
 */
export interface DragSource {
  kltId: string
  name: string
}

export type DropVerdict =
  | {
      ok: true
      /** `reparent` moves an existing node; `place` gives an unplaced concept its first home. */
      kind: 'reparent' | 'place'
      /** How many nodes change position. 1 means the dragged node alone. */
      movedCount: number
      /**
       * Whether to ask before writing. True exactly when the move carries
       * OTHER nodes with it — that is the whole reason the confirm step
       * exists, so a drag that moves one node applies immediately and a drag
       * that reorganises a branch still stops to say how big it is.
       */
      needsConfirm: boolean
    }
  | { ok: false; reason: string }

/**
 * `sourceKltId` is the dragged concept — either a node already in `nodes`, or
 * an unplaced concept that has no row yet. `targetKltId` is the node it was
 * dropped on, or `null` for the empty canvas, meaning "make this a root".
 */
export function evaluateDrop(
  sourceKltId: string,
  targetKltId: string | null,
  nodes: TreeNodeRow[],
): DropVerdict {
  const byKltId = new Map(nodes.map((n) => [n.kltId, n]))
  const source = byKltId.get(sourceKltId) ?? null
  const target = targetKltId === null ? null : byKltId.get(targetKltId) ?? null

  if (targetKltId !== null && !target) {
    return { ok: false, reason: 'That concept is not in this set' }
  }

  // An unplaced concept: nothing to move, so the only question is whether the
  // target can take a child at all.
  if (!source) {
    if (target && target.depth + 1 >= MAX_TREE_DEPTH) {
      return { ok: false, reason: `Nesting is capped at ${MAX_TREE_DEPTH} levels` }
    }
    return { ok: true, kind: 'place', movedCount: 1, needsConfirm: false }
  }

  if (target && target.kltId === source.kltId) {
    return { ok: false, reason: 'A concept cannot be its own parent' }
  }
  if (target && target.ancestorIds.includes(source.kltId)) {
    return { ok: false, reason: `“${target.name}” is already inside “${source.name}”` }
  }
  if ((target?.kltId ?? null) === source.parentKltId) {
    return {
      ok: false,
      reason: target ? `Already under “${target.name}”` : 'Already a root concept',
    }
  }

  // The same arithmetic `reparentConcept` runs server-side, including the
  // depth cap for the whole subtree — so the count shown in the confirm is
  // the count that will actually be written, not an estimate.
  let movedCount: number
  try {
    movedCount = computeSubtreeUpdates(source.kltId, target?.kltId ?? null, nodes).length
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unable to move concept' }
  }

  if (movedCount === 0) return { ok: false, reason: 'Nothing would change' }

  return { ok: true, kind: 'reparent', movedCount, needsConfirm: movedCount > 1 }
}
