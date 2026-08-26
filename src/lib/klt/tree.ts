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

/**
 * One SET's view of a concept's placement — what `checkTreeInvariants` reads.
 *
 * `id` is the `SetKltNode` row; `kltId` is the concept it places, and is what
 * `parentKltId`/`ancestorIds` point at (within this same set's rows). The two
 * are different values in general — a concept's row id and the concept it
 * names are not the same thing — which is exactly what makes a per-set
 * structure over a shared vocabulary possible.
 */
export interface SetNodeRow {
  id: string // the SetKltNode row
  kltId: string // the concept — what parentKltId and ancestorIds hold
  parentKltId: string | null
  depth: number
  ancestorIds: string[]
}

/**
 * `SetNodeRow` plus the concept's display name — what the tree math functions
 * below actually operate on. One keying convention, not two near-duplicate
 * shapes: everywhere a `parentKltId` or an `ancestorIds` entry is compared, it
 * is compared against `kltId`, NEVER against `id`. `id` only ever identifies
 * *which row to write* — it plays no part in the tree's shape.
 */
export interface TreeNodeRow extends SetNodeRow {
  name: string
  normalizedName: string
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
  // Walks by `kltId`, not `id`: `childrenOf` is keyed on `parentKltId`, which
  // holds the PARENT's `kltId` — so finding a node's own children means
  // looking it up under its own `kltId`, not the row id that merely names
  // which `SetKltNode` this is.
  const walk = (parentKltId: string | null, indent: number) => {
    const kids = [...(childrenOf.get(parentKltId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const k of kids) {
      lines.push(`${'  '.repeat(indent)}${k.name}`)
      walk(k.kltId, indent + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n')
}

/**
 * Would attaching `nodeKltId` under `newParentKltId` make it its own ancestor?
 *
 * Walks UP from the proposed parent. A cycle makes the rollup query
 * non-terminating and mastery meaningless, so this is checked before every
 * write rather than cleaned up after.
 *
 * Both arguments are `kltId`s (concepts), and `byKltId` must be keyed the
 * same way — a node's own row id never enters this walk, only the concept
 * chain `parentKltId` describes.
 */
export function wouldCycle(
  nodeKltId: string,
  newParentKltId: string,
  byKltId: Map<string, TreeNodeRow>,
): boolean {
  let cursor: string | null = newParentKltId
  const seen = new Set<string>()
  while (cursor !== null) {
    if (cursor === nodeKltId) return true
    // Defensive: a pre-existing cycle must not hang this walk.
    if (seen.has(cursor)) return true
    seen.add(cursor)
    cursor = byKltId.get(cursor)?.parentKltId ?? null
  }
  return false
}

/**
 * New depth/ancestors for a moved node and everything beneath it.
 *
 * `nodeKltId`/`newParentKltId` are concepts, matched against `rows` by
 * `kltId`; the returned `id` on each entry is that row's OWN `SetKltNode` id
 * (or the bare `kltId` as a fallback — see below), because a caller writes
 * with it, and a write always targets a specific row, never a concept alone.
 *
 * Returns ONLY rows whose values actually change, so a no-op move writes
 * nothing. Throws when the move would push any descendant past the cap —
 * refusing is correct, because the alternative is a tree whose depth means
 * nothing.
 */
export function computeSubtreeUpdates(
  nodeKltId: string,
  newParentKltId: string | null,
  rows: TreeNodeRow[],
): { id: string; depth: number; ancestorIds: string[] }[] {
  const byKltId = new Map(rows.map((r) => [r.kltId, r]))
  const node = byKltId.get(nodeKltId)
  if (!node) throw new Error(`unknown node ${nodeKltId}`)
  if (newParentKltId !== null && wouldCycle(nodeKltId, newParentKltId, byKltId)) {
    throw new Error(`moving ${nodeKltId} under ${newParentKltId} would create a cycle`)
  }

  const parent = newParentKltId === null ? null : byKltId.get(newParentKltId)
  if (newParentKltId !== null && !parent) throw new Error(`unknown parent ${newParentKltId}`)

  const baseDepth = parent ? parent.depth + 1 : 0
  const baseAncestors = parent ? [...parent.ancestorIds, parent.kltId] : []

  const childrenOf = new Map<string, TreeNodeRow[]>()
  for (const r of rows) {
    if (r.parentKltId === null) continue
    const list = childrenOf.get(r.parentKltId)
    if (list) list.push(r)
    else childrenOf.set(r.parentKltId, [r])
  }

  const out: { id: string; depth: number; ancestorIds: string[] }[] = []
  const walk = (kltId: string, depth: number, ancestorIds: string[]) => {
    if (depth >= MAX_TREE_DEPTH) {
      throw new Error(`move would exceed max depth ${MAX_TREE_DEPTH} at ${kltId}`)
    }
    const current = byKltId.get(kltId)
    const changed =
      current === undefined ||
      current.depth !== depth ||
      current.ancestorIds.join(',') !== ancestorIds.join(',')
    // `current?.id` is the row to write; `kltId` is only a fallback for a
    // node not present in `rows` at all, which the `node`/`parent` guards
    // above make unreachable for the walk's start but is kept here so a
    // future caller cannot turn a missing lookup into a thrown TypeError.
    if (changed) out.push({ id: current?.id ?? kltId, depth, ancestorIds })
    for (const child of childrenOf.get(kltId) ?? []) {
      walk(child.kltId, depth + 1, [...ancestorIds, kltId])
    }
  }
  walk(nodeKltId, baseDepth, baseAncestors)
  return out
}
