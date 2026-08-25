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

/**
 * For every node, the normalizedNames of itself PLUS every ancestor —
 * readiness's DENOMINATOR needs the same fold `rollUpKltLinks` gives the
 * numerator (links), or every interior node's analyzed-answer count stays 0
 * forever and `computeArticulation`'s `analyzedAnswers === 0` branch pins its
 * readiness to `null` no matter how much evidence its descendant leaves carry
 * — the exact "interior node reports nothing" bug this task exists to fix,
 * recreated for readiness alone (found in review, 2026-08-25).
 *
 * Takes the SAME rows `rollUpKltLinks` does (one query, threaded through
 * rather than re-fetched) — `ancestorIds` is a list of ids, so translating it
 * to normalizedNames needs the whole tree's id -> normalizedName map, which
 * is exactly what's already in hand at the `loadKltRows` call site.
 */
export function buildAncestorClosureByName(
  rows: Pick<KltNodeRow, 'id' | 'normalizedName' | 'ancestorIds'>[],
): Map<string, string[]> {
  const nameById = new Map(rows.map((r) => [r.id, r.normalizedName]))
  const closure = new Map<string, string[]>()
  for (const row of rows) {
    const ancestorNames = row.ancestorIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => n !== undefined)
    closure.set(row.normalizedName, [row.normalizedName, ...ancestorNames])
  }
  return closure
}

/**
 * Fold each answer's DIRECT topics up through `ancestorClosureByName`, then
 * count each resulting name ONCE PER ANSWER — this is readiness's DENOMINATOR
 * fold, the counterpart to `rollUpKltLinks` (the numerator's).
 *
 * The existing "one answer counts once per topic" rule must survive the
 * fold, not just be preserved for a topic named directly: a card whose five
 * KLPs all sit under "DCF" must not inflate "DCF"'s count fivefold, AND a
 * card whose two KLPs sit under two DIFFERENT leaves that share one ancestor
 * must not inflate the ANCESTOR'S count twice for what is still one answer.
 * Both are enforced by the same per-answer `Set` — closure names collapse
 * into it exactly like direct names always did.
 */
export function countAnalyzedAnswersByTopic(
  answers: { topicNames: string[] }[],
  ancestorClosureByName: Map<string, string[]>,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const a of answers) {
    const seen = new Set<string>()
    for (const name of a.topicNames) {
      const closure = ancestorClosureByName.get(name) ?? [name]
      for (const n of closure) seen.add(n)
    }
    for (const key of seen) counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}
