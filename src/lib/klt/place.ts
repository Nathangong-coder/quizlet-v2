/**
 * The placement pipeline: attaches unparented concepts into the tree.
 *
 * Task 5 built the prompt that asks an AI where an unplaced concept hangs —
 * it returns a full path like `finance > accounting > financial statements >
 * liquidity ratios > quick ratio`. This module calls it and writes the
 * result: matching path segments against existing nodes, creating only what
 * is missing, and refusing anything unsafe.
 */
import { generateJson } from '@/lib/ai/generate'
import { PLACE_KLTS_PROMPT } from '@/lib/ai/prompts/place-klts'
import { KltPlacementSchema, type KltPlacement } from '@/lib/ai/schemas'
import { parseKltName } from '@/lib/klt/normalize'
import { renderTreeForPrompt, wouldCycle, MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

export type KltPlacer = (input: { userId: string; prompt: string }) => Promise<KltPlacement>

export const defaultKltPlacer: KltPlacer = ({ userId, prompt }) =>
  generateJson({ userId, task: 'autocomplete', prompt, schema: KltPlacementSchema })

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
 * Place every concept that has no parent yet.
 *
 * NEVER THROWS — it runs from `after()` and from a script. A failure leaves
 * concepts unparented, which is the honest resting state: they still hold
 * their key points and still report mastery as their own node, they simply do
 * not roll up. Fabricating a parent would be indistinguishable from a correct
 * one and would move real numbers.
 */
export async function placeUnparentedConcepts(
  userId: string,
  generate: KltPlacer = defaultKltPlacer,
): Promise<void> {
  // Lazy, like `generateJson` itself — a static top-level import of
  // `@/lib/db` throws at MODULE LOAD if `DATABASE_URL` is unset, which would
  // break the pure-resolver tests (and any script that only wants
  // `resolvePlacementPath`) before this function ever runs. Bringing the
  // import inside the try also folds "prisma failed to even initialize" into
  // the same never-throws path as "the query failed".
  let prisma: (typeof import('@/lib/db'))['prisma']
  let all: TreeNodeRow[]
  try {
    ;({ prisma } = await import('@/lib/db'))
    all = await prisma.klt.findMany({
      select: {
        id: true, name: true, normalizedName: true,
        parentKltId: true, depth: true, ancestorIds: true,
      },
    })
  } catch {
    return
  }

  // A root is a node with children and no parent; an unplaced concept is a
  // node with neither. Distinguishing them matters — re-placing a root would
  // try to hang a whole subject under something else.
  const hasChildren = new Set(all.map((n) => n.parentKltId).filter((id): id is string => id !== null))
  const unplaced = all.filter((n) => n.parentKltId === null && !hasChildren.has(n.id))
  if (unplaced.length === 0) return

  // Everything that is ALREADY real tree structure — i.e. not one of the
  // concepts this run is trying to place. This must exclude the unplaced set,
  // not just filter it out of the prompt: an unplaced concept's own row is
  // still sitting in `all` (parentless), keyed under its own name. If it were
  // left in `byNormalized` below, resolving a path that ends at that same
  // concept would find it "already existing" at the final step — either
  // self-parenting a root-level placement, or (once any ancestor needed
  // creating first) tripping the match-after-creation rejection on every
  // single placement. Newly created/placed nodes are added back into this map
  // as the loop below proceeds, which is what lets a later placement in the
  // same run reuse them.
  const placed = all.filter((n) => !unplaced.includes(n))

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

  const byNormalized = new Map(placed.map((n) => [n.normalizedName, n]))
  const byId = new Map(placed.map((n) => [n.id, n]))
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
    // unplaced this run must not be upserted into: `Klt.normalizedName` is
    // globally unique, so the upsert would match that existing (parentless)
    // row and take its `update: {}` no-op branch instead of truly creating a
    // child of `parent` — silently stranding the row exactly where it was
    // while our in-memory map wrongly believes it was just re-parented.
    // Skipping leaves this placement unplaced this round, which a later run
    // (once that other concept has its own real parent) resolves correctly.
    const ancestorSpecs = resolved.toCreate.slice(0, -1)
    if (ancestorSpecs.some((spec) => unplacedByNormalized.has(spec.normalizedName))) continue

    try {
      await applyPlacement(prisma, node, resolved, byNormalized, byId)
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
 * Create the missing chain and attach the concept, in one transaction.
 *
 * `byNormalized`/`byId` are updated in place, but only AFTER the transaction
 * resolves — mutating them from inside the callback would let a ROLLED BACK
 * transaction leave phantom nodes that a later placement in this run could
 * "match" against rows that were never actually written. Updating them at
 * all (rather than not bothering) is what lets a later placement in the same
 * run reuse a node this one created — without it, two concepts sharing a new
 * ancestor would each mint their own copy and the tree would fork on its
 * first run.
 */
async function applyPlacement(
  prisma: (typeof import('@/lib/db'))['prisma'],
  node: TreeNodeRow,
  resolved: ResolvedPlacement,
  byNormalized: Map<string, TreeNodeRow>,
  byId: Map<string, TreeNodeRow>,
): Promise<void> {
  const parentChain = resolved.toCreate.slice(0, -1) // last entry IS the node
  const createdInTx: TreeNodeRow[] = []
  let parent = resolved.matched[resolved.matched.length - 1] ?? null

  await prisma.$transaction(async (tx) => {
    for (const spec of parentChain) {
      const created = await tx.klt.upsert({
        where: { normalizedName: spec.normalizedName },
        create: {
          name: spec.name,
          normalizedName: spec.normalizedName,
          parentKltId: parent?.id ?? null,
          depth: parent ? parent.depth + 1 : 0,
          ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
        },
        update: {},
        select: {
          id: true, name: true, normalizedName: true,
          parentKltId: true, depth: true, ancestorIds: true,
        },
      })
      createdInTx.push(created)
      parent = created
    }

    // Belt-and-braces (Task 6 review, C1): refuse to write a self-parent or a
    // cycle, checked against the FINAL parent this placement would use — the
    // one just-created ancestors included. `unplacedByNormalized.delete` on
    // success (in the caller) already closes the one reachable path to this
    // in normal operation (the same concept named twice in one AI reply); this
    // is the backstop for if that ever regresses, checked right before the
    // write it would corrupt.
    if (parent) {
      const localById = new Map(byId)
      for (const created of createdInTx) localById.set(created.id, created)
      localById.set(node.id, node)
      if (parent.id === node.id || wouldCycle(node.id, parent.id, localById)) {
        throw new Error(
          `refusing to attach ${node.id} under ${parent.id}: would self-parent or create a cycle`,
        )
      }
    }

    await tx.klt.update({
      where: { id: node.id },
      data: {
        parentKltId: parent?.id ?? null,
        depth: parent ? parent.depth + 1 : 0,
        ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
      },
    })
  })

  // Only merged in once the transaction has actually committed — see the
  // doc comment above.
  for (const created of createdInTx) {
    byNormalized.set(created.normalizedName, created)
    byId.set(created.id, created)
  }
  const placedNode: TreeNodeRow = parent
    ? {
        ...node,
        parentKltId: parent.id,
        depth: parent.depth + 1,
        ancestorIds: [...parent.ancestorIds, parent.id],
      }
    : { ...node } // Placed as a ROOT (round 2 review, residual I2 hole): still
      // must be merged in, unconditionally -- otherwise a root placed here is
      // invisible to BOTH byNormalized (never merged before this fix) and
      // unplacedByNormalized (already deleted by the caller on success). A
      // later placement in this run proposing a NEW ancestor above this root
      // would then upsert-adopt it via its unique normalizedName instead of
      // matching it, silently stranding the new ancestor as a parentless,
      // childless orphan.
  byNormalized.set(node.normalizedName, placedNode)
  byId.set(node.id, placedNode)
}
