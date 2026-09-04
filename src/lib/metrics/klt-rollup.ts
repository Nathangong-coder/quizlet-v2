import type { RawKltRow } from '@/lib/memory/topic-profile'

/**
 * One SET's view of a concept node, as `loadKltRows` assembles it from
 * `SetKltNode` joined to `Klt`: the tree shape (`kltId`, `ancestorIds`,
 * `depth`) plus this node's OWN links — scoped to the cards in scope, not yet
 * rolled up to ancestors.
 *
 * Keyed on `kltId` (the concept), NEVER on a `SetKltNode` row id — that row id
 * identifies which row to write and plays no part in the tree's shape, exactly
 * as `SetNodeRow`/`TreeNodeRow` document in `@/lib/klt/tree`. `ancestorIds`
 * holds `kltId`s, and they are only ever meaningful WITHIN one set: the same
 * concept can sit under a different parent in a different set (spec §6.2), so
 * every function below is called ONCE PER SET (by `loadKltRows`) — mixing rows
 * from two sets into one call would fold a leaf's links into an ancestor chain
 * that isn't its own in that set.
 */
export interface KltNodeRow {
  kltId: string
  normalizedName: string
  name: string
  depth: number
  /** Root-first, EXCLUDING self, WITHIN THIS SET — see `SetKltNode.ancestorIds`. */
  ancestorIds: string[]
  links: RawKltRow['links']
}

/**
 * Fold every node's OWN links into itself and into each ancestor named in its
 * `ancestorIds`, in one TypeScript pass over one SET's rows.
 *
 * Controller ruling R3 (2026-08-25): the brief's illustrative Prisma `where`
 * ("links on this node or any descendant") does not work — there is no way to
 * express "links of my descendants" as a `where` filter without a recursive
 * query per node. Fetching one set's tree-shaped rows (small enough to render
 * in a single prompt — see `renderTreeForPrompt`) once and folding here is one
 * query per set instead of one per interior node.
 *
 * `ancestorIds` EXCLUDES self, so a node's own links must be counted for the
 * node itself AND folded into every ancestor — folding alone would silently
 * drop a leaf's own contribution to itself, and skipping self-attribution
 * would silently drop it from the leaf. Interior nodes with no direct links of
 * their own (`accounting` holds none — every key point sits on a leaf beneath
 * it) end up with only rolled-up links, which is the point of this pass:
 * without it every interior node reports nothing at all.
 *
 * Per-set-then-union (spec §6.2, Task 3): this function only ever sees ONE
 * set's rows — the caller (`loadKltRows`) resolves each set's subtree
 * independently and calls this once per set, then concatenates the resulting
 * `RawKltRow[]` arrays. A concept present in two sets therefore produces two
 * `RawKltRow` entries sharing a `normalizedName`; `kltRowsToTopicRows` and
 * `shapeTopicProfile` (both unchanged) group by `normalizedName` and
 * deduplicate `klpIds` through a `Set`, which is what turns the concatenation
 * into a union rather than a double count.
 */
export function rollUpKltLinks(rows: KltNodeRow[]): RawKltRow[] {
  const rolled = new Map<string, RawKltRow['links']>()

  const addLinks = (kltId: string, links: RawKltRow['links']) => {
    if (links.length === 0) return
    const existing = rolled.get(kltId)
    if (existing) existing.push(...links)
    else rolled.set(kltId, [...links])
  }

  for (const row of rows) {
    addLinks(row.kltId, row.links)
    for (const ancestorId of row.ancestorIds) addLinks(ancestorId, row.links)
  }

  const nameByKltId = new Map(rows.map((r) => [r.kltId, r.normalizedName]))

  return rows.map((row) => ({
    normalizedName: row.normalizedName,
    name: row.name,
    depth: row.depth,
    links: rolled.get(row.kltId) ?? [],
    parentName:
      row.ancestorIds.length === 0
        ? null
        : (nameByKltId.get(row.ancestorIds[row.ancestorIds.length - 1]) ?? null),
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
 * Takes the SAME rows `rollUpKltLinks` does, ONE SET at a time (one query per
 * set, threaded through rather than re-fetched) — `ancestorIds` is a list of
 * `kltId`s meaningful only within that set, so translating it to
 * normalizedNames needs that set's own id -> normalizedName map. `loadKltRows`
 * keeps one closure per set (`closuresBySet`) rather than merging them, since
 * two sets may disagree about a shared concept's ancestors (spec §6.2) and a
 * merged map would let one set's structure silently answer for another's.
 */
export function buildAncestorClosureByName(
  rows: Pick<KltNodeRow, 'kltId' | 'normalizedName' | 'ancestorIds'>[],
): Map<string, string[]> {
  const nameByKltId = new Map(rows.map((r) => [r.kltId, r.normalizedName]))
  const closure = new Map<string, string[]>()
  for (const row of rows) {
    const ancestorNames = row.ancestorIds
      .map((id) => nameByKltId.get(id))
      .filter((n): n is string => n !== undefined)
    closure.set(row.normalizedName, [row.normalizedName, ...ancestorNames])
  }
  return closure
}

/**
 * For every node, its ancestors' DISPLAY names, root first, EXCLUDING self —
 * the breadcrumb shown under a topic name on `/profile/learner` (Task 8).
 *
 * Deliberately separate from `buildAncestorClosureByName`: that map is
 * normalizedName self+ancestors, built for a SCORING fold (readiness's
 * denominator), where self must be included and a normalized key is what the
 * rest of the pipeline joins on. This map is DISPLAY `name`s, ancestors only,
 * for a human-facing label — a root topic (`depth === 0`) correctly gets an
 * empty array here, since it has no ancestors to show.
 */
export function buildAncestorBreadcrumbByName(
  rows: Pick<KltNodeRow, 'kltId' | 'normalizedName' | 'name' | 'ancestorIds'>[],
): Map<string, string[]> {
  const nameByKltId = new Map(rows.map((r) => [r.kltId, r.name]))
  const breadcrumbs = new Map<string, string[]>()
  for (const row of rows) {
    breadcrumbs.set(
      row.normalizedName,
      row.ancestorIds.map((id) => nameByKltId.get(id)).filter((n): n is string => n !== undefined),
    )
  }
  return breadcrumbs
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
