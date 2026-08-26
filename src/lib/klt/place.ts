/**
 * The placement pipeline: attaches unparented concepts into ONE SET's tree.
 *
 * Task 5 (of the KLT concept-tree phase) built the prompt that asks an AI
 * where an unplaced concept hangs — it returns a full path like `finance >
 * accounting > financial statements > liquidity ratios > quick ratio`. This
 * module calls it and writes the result: matching path segments against
 * nodes ALREADY PLACED IN THIS SET, creating only what is missing, and
 * refusing anything unsafe.
 *
 * Structure lives on `SetKltNode`, one row per (set, concept) — see
 * `docs/superpowers/specs/2026-08-25-klt-per-set-structure-design.md`. `Klt`
 * itself is a global, structure-free vocabulary: "quick ratio" is one row for
 * the whole install, but whether it sits under `finance > liquidity` or
 * somewhere else entirely is a fact about the SET, not the concept. A concept
 * unplaced in set A may already be placed in set B — that is independent, and
 * intentionally so (spec §6.1): two sets may each grow their own hierarchy
 * over the same shared names.
 */
import { generateJson } from '@/lib/ai/generate'
import { PLACE_KLTS_PROMPT } from '@/lib/ai/prompts/place-klts'
import { KltPlacementSchema, type KltPlacement } from '@/lib/ai/schemas'
import { parseKltName } from '@/lib/klt/normalize'
import { renderTreeForPrompt, wouldCycle, MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

export type KltPlacer = (input: { userId: string; prompt: string }) => Promise<KltPlacement>

export const defaultKltPlacer: KltPlacer = ({ userId, prompt }) =>
  generateJson({ userId, task: 'autocomplete', prompt, schema: KltPlacementSchema })

/**
 * A concept this set has linked (via `KlpTopic`, transitively through its
 * cards' `CardKlp`s) but has no `SetKltNode` for yet. Deliberately NOT a
 * `TreeNodeRow`: it has no place in the tree at all yet, so it carries no
 * `id` (no `SetKltNode` row exists to name), no `parentKltId`, no `depth`,
 * no `ancestorIds` — inventing placeholder values for those would blur the
 * exact distinction this module exists to keep sharp.
 */
export interface UnplacedConcept {
  kltId: string
  name: string
  normalizedName: string
}

export interface ResolvedPlacement {
  /** Existing nodes matched, root-first. */
  matched: TreeNodeRow[]
  /** Names to create, in order, each a child of the previous. */
  toCreate: { name: string; normalizedName: string }[]
}

/**
 * Split a proposed path into "already exists" and "must be created".
 *
 * PURE. Every rejection rule lives here so all of them are testable without a
 * database or an AI call:
 *
 * - A match appearing AFTER a creation is refused outright. It would mean
 *   re-parenting an existing node — moving it and its whole subtree, and every
 *   key point's mastery with it — as a side effect of placing an unrelated
 *   concept. Refusing leaves the concept unplaced, which is recoverable.
 * - A path past the LENGTH cap is refused WHOLE. Truncating attaches the
 *   concept under the wrong parent, which is worse than leaving it unplaced.
 * - A path whose RESULTING depth would reach the cap is also refused whole,
 *   even when the path itself is short — a short path anchored deep in the
 *   tree (via a matched prefix) can still land past the cap. Path length
 *   alone only bounds a path anchored at the root.
 * - A repeated name is refused: it is a cycle expressed as a path.
 * - Any segment failing `parseKltName` refuses the path, rather than dropping
 *   the segment — dropping a middle rung silently changes what the path means.
 *
 * `byNormalized` is scoped to ONE set's already-placed nodes — the caller
 * (`placeUnparentedConcepts`) builds it from that set's `SetKltNode` rows
 * only, which is what makes matching here set-scoped without this function
 * needing to know about sets at all.
 */
export function resolvePlacementPath(
  path: string[],
  byNormalized: Map<string, TreeNodeRow>,
): ResolvedPlacement | null {
  if (path.length === 0 || path.length > MAX_TREE_DEPTH) return null

  const parsed = path.map((p) => parseKltName(p))
  if (parsed.some((p) => p === null)) return null
  const names = parsed as { name: string; normalizedName: string }[]

  if (new Set(names.map((n) => n.normalizedName)).size !== names.length) return null

  const matched: TreeNodeRow[] = []
  const toCreate: { name: string; normalizedName: string }[] = []
  for (const n of names) {
    const existing = byNormalized.get(n.normalizedName)
    if (existing) {
      if (toCreate.length > 0) return null // match after a creation — see doc.
      matched.push(existing)
    } else {
      toCreate.push(n)
    }
  }

  // The depth the LAST created node (the concept itself, always the final
  // `toCreate` entry) would land at. `toCreate` is never empty here: the
  // concept's own row can never already be a member of `byNormalized` (a
  // normalizedName is globally unique, and callers exclude the concept's own
  // row from the map precisely so this branch is reachable — see the
  // `placed` comment in `placeUnparentedConcepts`).
  if (toCreate.length > 0) {
    const anchorDepth = matched.length > 0 ? matched[matched.length - 1].depth + 1 : 0
    const resultingDepth = anchorDepth + toCreate.length - 1
    if (resultingDepth >= MAX_TREE_DEPTH) return null
  }

  return { matched, toCreate }
}

/**
 * Place every concept THIS SET has linked but not yet parented.
 *
 * NEVER THROWS — it runs from `after()` and from a script. A failure leaves
 * concepts unparented, which is the honest resting state: they still hold
 * their key points and still report mastery as their own node, they simply do
 * not roll up. Fabricating a parent would be indistinguishable from a correct
 * one and would move real numbers.
 */
export async function placeUnparentedConcepts(
  userId: string,
  setId: string,
  generate: KltPlacer = defaultKltPlacer,
): Promise<void> {
  // Lazy, like `generateJson` itself — a static top-level import of
  // `@/lib/db` throws at MODULE LOAD if `DATABASE_URL` is unset, which would
  // break the pure-resolver tests (and any script that only wants
  // `resolvePlacementPath`) before this function ever runs. Bringing the
  // import inside the try also folds "prisma failed to even initialize" into
  // the same never-throws path as "the query failed".
  let prisma: (typeof import('@/lib/db'))['prisma']
  let placed: TreeNodeRow[]
  let unplaced: UnplacedConcept[]
  try {
    ;({ prisma } = await import('@/lib/db'))

    const [nodes, links] = await Promise.all([
      // This set's own tree, and ONLY this set's — a concept placed in
      // another set never appears here, so it can never be treated as an
      // existing match for this set's placements.
      prisma.setKltNode.findMany({
        where: { setId },
        select: {
          id: true,
          kltId: true,
          parentKltId: true,
          depth: true,
          ancestorIds: true,
          klt: { select: { name: true, normalizedName: true } },
        },
      }),
      // Every concept THIS SET's cards have linked, via KlpTopic -> CardKlp
      // -> Card.setId. A concept is "unplaced" (below) when it shows up here
      // but has no row in `nodes` above — the same concept linked by a
      // DIFFERENT set's cards is irrelevant to this query entirely, because
      // the `klp.card.setId` filter never reaches it.
      prisma.klpTopic.findMany({
        where: { klp: { card: { setId } } },
        select: { kltId: true, klt: { select: { name: true, normalizedName: true } } },
        distinct: ['kltId'],
      }),
    ])

    placed = nodes.map((n) => ({
      id: n.id,
      kltId: n.kltId,
      name: n.klt.name,
      normalizedName: n.klt.normalizedName,
      parentKltId: n.parentKltId,
      depth: n.depth,
      ancestorIds: n.ancestorIds,
    }))

    const placedKltIds = new Set(placed.map((n) => n.kltId))
    unplaced = links
      .filter((l) => !placedKltIds.has(l.kltId))
      .map((l) => ({ kltId: l.kltId, name: l.klt.name, normalizedName: l.klt.normalizedName }))
  } catch {
    return
  }

  if (unplaced.length === 0) return

  let result: KltPlacement
  try {
    result = await generate({
      userId,
      prompt: PLACE_KLTS_PROMPT.build({
        tree: renderTreeForPrompt(placed),
        concepts: unplaced.map((n) => n.name),
      }),
    })
  } catch {
    // NEVER THROWS. This runs inside `after()`, where an escaped exception
    // surfaces as an unhandled rejection long after the response went out —
    // and `generateJson` can throw more than `AiGenerationError` (raw Prisma
    // errors from `resolveCandidates`/`flagFailures`, for instance). Any
    // failure here means "no placements this round"; unplaced is always a
    // valid, honest resting state and a later run tries again.
    return
  }

  // `byNormalized`/`byKltId` hold only nodes ALREADY PLACED IN THIS SET —
  // `unplaced` concepts are deliberately excluded so that resolving a path
  // ending at one of them reaches the `toCreate` branch (see the `placed`
  // comment on `resolvePlacementPath`), and are merged in only once actually
  // written. `byKltId` is keyed by `kltId` (the concept), NOT by row `id` —
  // that is what lets `wouldCycle` walk `parentKltId` (also a `kltId`) and
  // land on the right node.
  const byNormalized = new Map(placed.map((n) => [n.normalizedName, n]))
  const byKltId = new Map(placed.map((n) => [n.kltId, n]))
  const unplacedByNormalized = new Map(unplaced.map((n) => [n.normalizedName, n]))

  // Shortest path first. A concept's own path is generally no longer than a
  // descendant's path that names it as an ancestor, so this tends to place
  // ancestors before the descendants that reference them — letting the
  // descendant's own resolution find a REAL match in `byNormalized` instead
  // of trying to create an ancestor whose name collides with a still-unplaced
  // row (see the collision check below, which is the backstop for when
  // sorting alone doesn't fully order things — e.g. an ancestor concept the
  // model never returned its own placement for).
  const sorted = [...result.placements].sort((a, b) => a.path.length - b.path.length)

  for (const placement of sorted) {
    const target = parseKltName(placement.concept)
    if (!target) continue
    const node = unplacedByNormalized.get(target.normalizedName)
    if (!node) continue // Hallucinated concept, or one already placed this run.

    // The path must END at the concept being placed; anything else means the
    // model drifted and the path describes a different node.
    const last = parseKltName(placement.path[placement.path.length - 1] ?? '')
    if (!last || last.normalizedName !== target.normalizedName) continue

    const resolved = resolvePlacementPath(placement.path, byNormalized)
    if (!resolved) continue

    // A `toCreate` ancestor whose name collides with a concept that is STILL
    // unplaced (in THIS SET) this run must not be silently adopted as
    // structure: this set has its own, independent decision left to make
    // about where that concept goes, and creating its `SetKltNode` here — as
    // an incidental side effect of placing a DIFFERENT concept — would
    // pre-empt that decision with whatever path this unrelated placement
    // happened to propose, rather than the (possibly different) path the
    // model returns for it directly. Skipping leaves this placement unplaced
    // this round; a later run (once that other concept has its own real
    // placement in this set) resolves correctly.
    const ancestorSpecs = resolved.toCreate.slice(0, -1)
    if (ancestorSpecs.some((spec) => unplacedByNormalized.has(spec.normalizedName))) continue

    try {
      await applyPlacement(prisma, setId, node, resolved, byNormalized, byKltId)
      // Removed only on SUCCESS, and only here: this is what makes the
      // "Hallucinated concept, or one already placed this run" comment above
      // true. Without it, the SAME concept named twice in one AI reply would
      // be looked up and processed a second time — by then `byNormalized`
      // holds this concept's own just-written row, so the second pass would
      // resolve a path that "matches" the concept against itself. That is
      // exactly the self-parent case `applyPlacement`'s own guard (see C1 in
      // the Task 6 review) refuses — this removal is the fix at the source;
      // the guard there is kept anyway as a backstop.
      unplacedByNormalized.delete(target.normalizedName)
    } catch {
      // One bad placement must not abandon the rest of the batch.
    }
  }
}

/**
 * Create the missing chain and attach the concept to THIS SET, in one
 * transaction.
 *
 * Each `toCreate` segment needs TWO writes, because the vocabulary and the
 * structure are two different tables now: `klt.upsert` gets-or-creates the
 * concept by `normalizedName` (globally unique — reusing a name that already
 * exists elsewhere in the install is correct, not a bug: "WACC" is one
 * concept for the whole install), and `setKltNode.upsert` places THAT concept
 * within THIS set specifically. `upsert` (not `create`) on both, so a retry
 * or a concurrent run converges instead of racing to create a duplicate.
 *
 * `byNormalized`/`byKltId` are updated in place, but only AFTER the
 * transaction resolves — mutating them from inside the callback would let a
 * ROLLED BACK transaction leave phantom nodes that a later placement in this
 * run could "match" against rows that were never actually written. Updating
 * them at all (rather than not bothering) is what lets a later placement in
 * the same run reuse a node this one created — without it, two concepts
 * sharing a new ancestor would each mint their own copy and the tree would
 * fork on its first run.
 */
async function applyPlacement(
  prisma: (typeof import('@/lib/db'))['prisma'],
  setId: string,
  node: UnplacedConcept,
  resolved: ResolvedPlacement,
  byNormalized: Map<string, TreeNodeRow>,
  byKltId: Map<string, TreeNodeRow>,
): Promise<void> {
  const parentChain = resolved.toCreate.slice(0, -1) // last entry IS the node
  const createdInTx: TreeNodeRow[] = []
  let parent: TreeNodeRow | null = resolved.matched[resolved.matched.length - 1] ?? null

  let placedNode!: TreeNodeRow

  await prisma.$transaction(async (tx) => {
    for (const spec of parentChain) {
      const klt = await tx.klt.upsert({
        where: { normalizedName: spec.normalizedName },
        create: { name: spec.name, normalizedName: spec.normalizedName },
        update: {},
        select: { id: true, name: true, normalizedName: true },
      })
      const parentKltId = parent?.kltId ?? null
      const depth = parent ? parent.depth + 1 : 0
      const ancestorIds = parent ? [...parent.ancestorIds, parent.kltId] : []
      const setNode = await tx.setKltNode.upsert({
        where: { setId_kltId: { setId, kltId: klt.id } },
        create: { setId, kltId: klt.id, parentKltId, depth, ancestorIds },
        update: {},
        select: { id: true, kltId: true, parentKltId: true, depth: true, ancestorIds: true },
      })
      const createdRow: TreeNodeRow = {
        id: setNode.id,
        kltId: setNode.kltId,
        name: klt.name,
        normalizedName: klt.normalizedName,
        parentKltId: setNode.parentKltId,
        depth: setNode.depth,
        ancestorIds: setNode.ancestorIds,
      }
      createdInTx.push(createdRow)
      parent = createdRow
    }

    // Belt-and-braces (Task 6 review, C1, of the KLT concept-tree phase):
    // refuse to write a self-parent or a cycle, checked against the FINAL
    // parent this placement would use — the one just-created/just-adopted
    // ancestors included, and keyed by `kltId` throughout since that is what
    // `parentKltId`/`wouldCycle` operate on now. `unplacedByNormalized.delete`
    // on success (in the caller) already closes the one reachable path to
    // this in normal operation (the same concept named twice in one AI
    // reply); this is the backstop for a concurrently-adopted ancestor that
    // (unknown to this run's stale snapshot) already descends from `node`.
    if (parent) {
      const localByKltId = new Map(byKltId)
      for (const created of createdInTx) localByKltId.set(created.kltId, created)
      if (parent.kltId === node.kltId || wouldCycle(node.kltId, parent.kltId, localByKltId)) {
        throw new Error(
          `refusing to attach ${node.kltId} under ${parent.kltId}: would self-parent or create a cycle`,
        )
      }
    }

    const parentKltId = parent?.kltId ?? null
    const depth = parent ? parent.depth + 1 : 0
    const ancestorIds = parent ? [...parent.ancestorIds, parent.kltId] : []
    // `node` is unplaced IN THIS SET by definition (that is what put it in
    // `unplaced`), so this is always a genuinely new `SetKltNode` — never an
    // update of an existing one. `upsert` anyway (not a bare `create`), for
    // the same concurrent-run safety as the ancestor writes above.
    const setNode = await tx.setKltNode.upsert({
      where: { setId_kltId: { setId, kltId: node.kltId } },
      create: { setId, kltId: node.kltId, parentKltId, depth, ancestorIds },
      update: {},
      select: { id: true, kltId: true, parentKltId: true, depth: true, ancestorIds: true },
    })
    placedNode = {
      id: setNode.id,
      kltId: setNode.kltId,
      name: node.name,
      normalizedName: node.normalizedName,
      parentKltId: setNode.parentKltId,
      depth: setNode.depth,
      ancestorIds: setNode.ancestorIds,
    }
  })

  // Only merged in once the transaction has actually committed — see the
  // doc comment above.
  for (const created of createdInTx) {
    byNormalized.set(created.normalizedName, created)
    byKltId.set(created.kltId, created)
  }
  byNormalized.set(placedNode.normalizedName, placedNode)
  byKltId.set(placedNode.kltId, placedNode)
}
