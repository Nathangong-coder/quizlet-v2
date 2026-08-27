/**
 * Shared structure-mutation mechanics for ONE SET's concept tree — no
 * `'use server'` here, deliberately.
 *
 * `loadSetTree` and `applyPaths` used to live inside `klt-tree.ts` and
 * `klt-seed.ts` respectively, both `'use server'` action modules, so
 * `klt-presets.ts` could import and reuse them. In Next.js, EVERY export of
 * a file-level `'use server'` module is registered as a client-callable
 * server-action endpoint — not just the ones another module happens to
 * import. Both functions take a bare `setId` with no session or ownership
 * check of their own (they trust the caller to have already resolved access
 * via `requireSetKltAccess`), so leaving them exported from an action module
 * made them directly callable by anyone with the action id:
 * `loadSetTree(setId)` would hand back another owner's whole concept tree,
 * and `applyPaths(setId, paths)` would WRITE structure into an arbitrary
 * set with no gate at all.
 *
 * Living here instead — a plain library module — means neither function is
 * reachable as an RPC endpoint. Every caller (`klt-tree.ts`, `klt-seed.ts`,
 * `klt-presets.ts`) still calls `requireSetKltAccess` itself and passes
 * `access.setId`, never the raw argument, exactly as before. No behaviour
 * changed — only where these two functions live.
 */
import { prisma } from '@/lib/db';
import { resolvePlacementPath, type ResolvedPlacement } from '@/lib/klt/place';
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree';

const SET_NODE_SELECT = {
  id: true,
  kltId: true,
  parentKltId: true,
  depth: true,
  ancestorIds: true,
  color: true,
  icon: true,
  klt: { select: { name: true, normalizedName: true } },
} as const

/**
 * A `TreeNodeRow` plus this set's cosmetic overrides.
 *
 * `color`/`icon` ride along on the same read rather than costing a second
 * query, but stay OFF `TreeNodeRow` itself: that type is the input to the
 * tree math in `tree.ts`, which must never be able to see, let alone branch
 * on, a display value.
 */
export type SetTreeRow = TreeNodeRow & { color: string | null; icon: string | null };

/**
 * THIS SET's tree, and only this set's.
 *
 * Every action reads through this one function, so the `where: { setId }`
 * appears once rather than at five call sites — a concept placed in another
 * set can never be reached, let alone matched or moved.
 *
 * Takes a bare `setId` with no gate of its own — every caller must resolve
 * access first (`requireSetKltAccess`) and pass `access.setId`, never a raw
 * argument. This is a plain library function precisely so it cannot be
 * called as a server-action RPC endpoint; see the file doc comment.
 */
export async function loadSetTree(setId: string): Promise<SetTreeRow[]> {
  const rows = await prisma.setKltNode.findMany({ where: { setId }, select: SET_NODE_SELECT });
  return rows.map((r) => ({
    id: r.id,
    kltId: r.kltId,
    name: r.klt.name,
    normalizedName: r.klt.normalizedName,
    parentKltId: r.parentKltId,
    depth: r.depth,
    ancestorIds: r.ancestorIds,
    color: r.color,
    icon: r.icon,
  }));
}

/**
 * Shared apply mechanics for BOTH the AI skeleton and Task 5's presets: given
 * a set already resolved by the caller's own gate (`requireSetKltAccess`),
 * create the missing chain for each accepted root-to-node path, IN THAT SET.
 *
 * Every rejection rule lives in `resolvePlacementPath` (imported, not
 * reimplemented) — a path whose match follows a creation is refused, an
 * over-deep path is refused whole, a repeated name is refused, and any
 * segment failing `parseKltName` refuses the whole path. `maxPathLength` is
 * an ADDITIONAL, caller-specific cap layered on top: a skeleton is top rungs
 * only (`MAX_SKELETON_DEPTH`, much shallower than the tree's own
 * `MAX_TREE_DEPTH`), while a preset may legitimately capture a set's WHOLE
 * structure, so it passes no extra cap and relies on `resolvePlacementPath`'s
 * own `MAX_TREE_DEPTH` alone.
 *
 * IDEMPOTENT: a path whose every segment already exists in this set resolves
 * to `toCreate.length === 0` — nothing was refused, the concept is simply
 * already there, so this does NOT count toward `skipped`.
 *
 * `skipped` counts only paths that were REFUSED (too deep for the caller's
 * own cap, empty, or a `resolvePlacementPath` null — e.g. one that would
 * re-parent an existing node). Skipping a bad path rather than failing the
 * whole call is right — one bad path should not discard an otherwise good
 * batch — but doing so silently is not: a caller that only sees `created`
 * never learns some rungs were refused. Callers surface both numbers.
 *
 * Takes a bare `setId` with no gate of its own — see the file doc comment.
 * Every caller must resolve access first and pass `access.setId`.
 */
export async function applyPaths(
  setId: string,
  paths: string[][],
  maxPathLength: number = MAX_TREE_DEPTH,
): Promise<{ created: number; skipped: number }> {
  const rows = await loadSetTree(setId);
  const byNormalized = new Map(rows.map((r) => [r.normalizedName, r]));

  let created = 0;
  let skipped = 0;
  for (const path of paths) {
    if (!Array.isArray(path) || path.length === 0 || path.length > maxPathLength) {
      skipped++;
      continue;
    }

    const resolved = resolvePlacementPath(path, byNormalized);
    if (!resolved) {
      skipped++;
      continue;
    }
    if (resolved.toCreate.length === 0) continue;

    created += await createChain(setId, resolved, byNormalized);
  }

  return { created, skipped };
}

/**
 * Create every missing segment of one resolved path, in order, each a child
 * of the previous, and place each one in THIS SET — the parent chain and the
 * final segment alike, unlike `place.ts`'s `applyPlacement` (which treats its
 * last segment as an EXISTING unplaced node to attach, not a node to create).
 * A skeleton has no pre-existing leaf to attach: every `toCreate` entry here
 * is new structure.
 *
 * Two tables per segment, same split as `createConcept` in `klt-tree.ts`:
 * `klt.upsert` gets-or-creates the concept by `normalizedName` (globally
 * unique — reusing a name that already exists elsewhere in the install is
 * correct, not a bug), and `setKltNode.upsert` places THAT concept within
 * THIS set specifically. `upsert` on both (not `create`), so a concurrent or
 * repeated call converges on the same rows instead of racing to create a
 * duplicate. `byNormalized` is updated in place as each segment is created so
 * the NEXT segment in the same path — and any later path in the same call —
 * can chain off it instead of re-resolving against a stale snapshot.
 */
async function createChain(
  setId: string,
  resolved: ResolvedPlacement,
  byNormalized: Map<string, TreeNodeRow>,
): Promise<number> {
  let parent = resolved.matched[resolved.matched.length - 1] ?? null;
  let count = 0;

  await prisma.$transaction(async (tx) => {
    for (const spec of resolved.toCreate) {
      const klt = await tx.klt.upsert({
        where: { normalizedName: spec.normalizedName },
        create: { name: spec.name, normalizedName: spec.normalizedName },
        update: {},
        select: { id: true, name: true, normalizedName: true },
      });
      const parentKltId = parent?.kltId ?? null;
      const depth = parent ? parent.depth + 1 : 0;
      const ancestorIds = parent ? [...parent.ancestorIds, parent.kltId] : [];
      const setNode = await tx.setKltNode.upsert({
        where: { setId_kltId: { setId, kltId: klt.id } },
        create: { setId, kltId: klt.id, parentKltId, depth, ancestorIds },
        update: {},
        select: { id: true, kltId: true, parentKltId: true, depth: true, ancestorIds: true },
      });
      const node: TreeNodeRow = {
        id: setNode.id,
        kltId: setNode.kltId,
        name: klt.name,
        normalizedName: klt.normalizedName,
        parentKltId: setNode.parentKltId,
        depth: setNode.depth,
        ancestorIds: setNode.ancestorIds,
      };
      byNormalized.set(node.normalizedName, node);
      parent = node;
      count++;
    }
  });

  return count;
}
