import type { RawKltRow } from '@/lib/memory/topic-profile'

/**
 * A `Klt` row as `loadKltRows` selects it: the tree shape (`id`,
 * `ancestorIds`, `depth`) plus this node's OWN links — scoped to the cards in
 * scope, not yet rolled up to ancestors.
 */
export interface KltNodeRow {
  id: string
  normalizedName: string
  name: string
  depth: number
  /** Root-first, EXCLUDING self — see `Klt.ancestorIds` in the Prisma schema. */
  ancestorIds: string[]
  links: RawKltRow['links']
}

/**
 * Fold every node's OWN links into itself and into each ancestor named in its
 * `ancestorIds`, in one TypeScript pass over one query's rows.
 *
 * Controller ruling R3 (2026-08-25): the brief's illustrative Prisma `where`
 * ("links on this node or any descendant") does not work — there is no way to
 * express "links of my descendants" as a `where` filter on `Klt` without a
 * recursive query per node. Fetching the whole (global, tree-shaped, small
 * enough to render in a single prompt — see `renderTreeForPrompt`) `Klt` table
 * once and folding here is one query instead of one per interior node.
 *
 * `ancestorIds` EXCLUDES self, so a node's own links must be counted for the
 * node itself AND folded into every ancestor — folding alone would silently
 * drop a leaf's own contribution to itself, and skipping self-attribution
 * would silently drop it from the leaf. Interior nodes with no direct links of
 * their own (`accounting` holds none — every key point sits on a leaf beneath
 * it) end up with only rolled-up links, which is the point of this pass:
 * without it every interior node reports nothing at all.
 */
export function rollUpKltLinks(rows: KltNodeRow[]): RawKltRow[] {
  const rolled = new Map<string, RawKltRow['links']>()

  const addLinks = (id: string, links: RawKltRow['links']) => {
    if (links.length === 0) return
    const existing = rolled.get(id)
    if (existing) existing.push(...links)
    else rolled.set(id, [...links])
  }

  for (const row of rows) {
    addLinks(row.id, row.links)
    for (const ancestorId of row.ancestorIds) addLinks(ancestorId, row.links)
  }

  return rows.map((row) => ({
    normalizedName: row.normalizedName,
    name: row.name,
    depth: row.depth,
    links: rolled.get(row.id) ?? [],
  }))
}
