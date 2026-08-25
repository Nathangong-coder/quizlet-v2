/**
 * Pure tree math. No Prisma types, no IO — every rule here is testable against
 * plain arrays, which matters because a mistake in depth or ancestor
 * computation silently moves which key points roll up where.
 */

/**
 * Deepest allowed chain. A path longer than this is rejected WHOLE, never
 * truncated: a truncated path attaches a concept under the wrong parent, which
 * is worse than leaving it unplaced.
 */
export const MAX_TREE_DEPTH = 8

export interface TreeNodeRow {
  id: string
  name: string
  normalizedName: string
  parentKltId: string | null
  depth: number
  ancestorIds: string[]
}

/**
 * The whole tree as indented names, parents before children.
 *
 * This is what Phase B sees. Names only — one short line per node — which is
 * why the entire tree fits in a prompt where a per-card candidate list would
 * not.
 */
export function renderTreeForPrompt(rows: TreeNodeRow[]): string {
  const childrenOf = new Map<string | null, TreeNodeRow[]>()
  for (const r of rows) {
    const list = childrenOf.get(r.parentKltId)
    if (list) list.push(r)
    else childrenOf.set(r.parentKltId, [r])
  }

  const lines: string[] = []
  const walk = (parentId: string | null, indent: number) => {
    const kids = [...(childrenOf.get(parentId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const k of kids) {
      lines.push(`${'  '.repeat(indent)}${k.name}`)
      walk(k.id, indent + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n')
}

/**
 * Would attaching `nodeId` under `newParentId` make it its own ancestor?
 *
 * Walks UP from the proposed parent. A cycle makes the rollup query
 * non-terminating and mastery meaningless, so this is checked before every
 * write rather than cleaned up after.
 */
export function wouldCycle(
  nodeId: string,
  newParentId: string,
  byId: Map<string, TreeNodeRow>,
): boolean {
  let cursor: string | null = newParentId
  const seen = new Set<string>()
  while (cursor !== null) {
    if (cursor === nodeId) return true
    // Defensive: a pre-existing cycle must not hang this walk.
    if (seen.has(cursor)) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentKltId ?? null
  }
  return false
}

/**
 * New depth/ancestors for a moved node and everything beneath it.
 *
 * Returns ONLY rows whose values actually change, so a no-op move writes
 * nothing. Throws when the move would push any descendant past the cap —
 * refusing is correct, because the alternative is a tree whose depth means
 * nothing.
 */
export function computeSubtreeUpdates(
  nodeId: string,
  newParentId: string | null,
  rows: TreeNodeRow[],
): { id: string; depth: number; ancestorIds: string[] }[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const node = byId.get(nodeId)
  if (!node) throw new Error(`unknown node ${nodeId}`)

  const parent = newParentId === null ? null : byId.get(newParentId)
  if (newParentId !== null && !parent) throw new Error(`unknown parent ${newParentId}`)

  const baseDepth = parent ? parent.depth + 1 : 0
  const baseAncestors = parent ? [...parent.ancestorIds, parent.id] : []

  // Check depth constraint before cycles — depth violation is checked
  // eagerly to fail fast on the fundamental constraint
  if (baseDepth >= MAX_TREE_DEPTH) {
    throw new Error(`move would exceed max depth ${MAX_TREE_DEPTH}`)
  }

  if (newParentId !== null && wouldCycle(nodeId, newParentId, byId)) {
    throw new Error(`moving ${nodeId} under ${newParentId} would create a cycle`)
  }

  const childrenOf = new Map<string, TreeNodeRow[]>()
  for (const r of rows) {
    if (r.parentKltId === null) continue
    const list = childrenOf.get(r.parentKltId)
    if (list) list.push(r)
    else childrenOf.set(r.parentKltId, [r])
  }

  const out: { id: string; depth: number; ancestorIds: string[] }[] = []
  const walk = (id: string, depth: number, ancestorIds: string[]) => {
    if (depth >= MAX_TREE_DEPTH) {
      throw new Error(`move would exceed max depth ${MAX_TREE_DEPTH} at ${id}`)
    }
    const current = byId.get(id)
    const changed =
      current === undefined ||
      current.depth !== depth ||
      current.ancestorIds.join(',') !== ancestorIds.join(',')
    if (changed) out.push({ id, depth, ancestorIds })
    for (const child of childrenOf.get(id) ?? []) {
      walk(child.id, depth + 1, [...ancestorIds, id])
    }
  }
  walk(nodeId, baseDepth, baseAncestors)
  return out
}
