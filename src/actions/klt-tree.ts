'use server';

import { prisma } from '@/lib/db';
import { requireSetKltAccess } from '@/lib/klt/access';
import { computeSubtreeUpdates, wouldCycle, MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree';
import { parseKltName } from '@/lib/klt/normalize';
import { isNodeColorKey, isNodeIconKey } from '@/lib/klt/node-style';
import { loadSetTree } from '@/lib/klt/structure';
import type { ActionResult } from '@/types/action';

/**
 * One placed concept in ONE SET's tree, as the editor screen renders it.
 *
 * `id` is the `SetKltNode` row (what a write targets); `kltId` is the concept
 * (what `parentKltId`/`ancestorIds` hold, and what every lookup keys on).
 * Conflating the two is the single easiest way to corrupt this table, so both
 * travel to the client and the client keys on `kltId` exactly as the server
 * does.
 *
 * `linkCount` is how many `CardKlp`s IN THIS SET cite this concept (via
 * `KlpTopic`); `childCount` is how many other nodes IN THIS SET are parented
 * here. Neither number enforces anything — `deleteConcept` recounts children
 * itself — they exist purely so a row can say "N links / M children".
 */
export interface ConceptTreeNode {
  id: string;
  kltId: string;
  name: string;
  normalizedName: string;
  parentKltId: string | null;
  depth: number;
  ancestorIds: string[];
  linkCount: number;
  childCount: number;
  /**
   * Cosmetic only, and null means "inherit" for `color` / "default glyph" for
   * `icon`. Nothing downstream of the canvas reads either — no placement, no
   * rollup, no mastery — so a null here costs a colour, never a number.
   */
  color: string | null;
  icon: string | null;
}

/**
 * A concept this set's cards cite but which has no `SetKltNode` here yet.
 *
 * Carries no `id`, `depth` or `parentKltId` — there is no row to name and no
 * position to report. Same distinction `UnplacedConcept` keeps in
 * `src/lib/klt/place.ts`, and for the same reason: a placeholder depth would
 * be indistinguishable from a real one.
 */
export interface UnplacedConcept {
  kltId: string;
  name: string;
  normalizedName: string;
  linkCount: number;
}

export interface ConceptTreeData {
  setId: string;
  setTitle: string;
  nodes: ConceptTreeNode[];
  unplaced: UnplacedConcept[];
}

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' };

/**
 * Write one subtree move (a node plus every descendant `computeSubtreeUpdates`
 * flagged as changed) inside an already-open transaction.
 *
 * `computeSubtreeUpdates` returns each row's OWN `SetKltNode` id, so these
 * updates target rows in the set they were read from and nowhere else.
 * `parentKltId` is only ever included for the moved node itself — every other
 * entry is a descendant whose own parent does not change, only its
 * denormalized `depth`/`ancestorIds`.
 */
async function applySubtreeMove(
  tx: { setKltNode: { update: typeof prisma.setKltNode.update } },
  nodeId: string,
  newParentKltId: string | null,
  updates: { id: string; depth: number; ancestorIds: string[] }[],
): Promise<void> {
  for (const u of updates) {
    await tx.setKltNode.update({
      where: { id: u.id },
      data: {
        parentKltId: u.id === nodeId ? newParentKltId : undefined,
        depth: u.depth,
        ancestorIds: u.ancestorIds,
      },
    });
  }
}

/** One set's whole tree plus its unplaced concepts, for the editor screen. */
export async function listConceptTree(setId: string): Promise<ActionResult<ConceptTreeData>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const [nodeRows, links] = await Promise.all([
    loadSetTree(access.setId),
    // Every concept THIS SET's cards cite. The `klp.card.setId` filter is
    // what keeps another set's links out of both the counts and the unplaced
    // list — same query shape `placeUnparentedConcepts` uses.
    prisma.klpTopic.findMany({
      where: { klp: { card: { setId: access.setId } } },
      select: { kltId: true, klt: { select: { name: true, normalizedName: true } } },
    }),
  ]);

  const linkCounts = new Map<string, number>();
  for (const l of links) linkCounts.set(l.kltId, (linkCounts.get(l.kltId) ?? 0) + 1);

  const childCounts = new Map<string, number>();
  for (const r of nodeRows) {
    if (r.parentKltId === null) continue;
    childCounts.set(r.parentKltId, (childCounts.get(r.parentKltId) ?? 0) + 1);
  }

  const nodes: ConceptTreeNode[] = nodeRows.map((r) => ({
    id: r.id,
    kltId: r.kltId,
    name: r.name,
    normalizedName: r.normalizedName,
    parentKltId: r.parentKltId,
    depth: r.depth,
    ancestorIds: r.ancestorIds,
    linkCount: linkCounts.get(r.kltId) ?? 0,
    childCount: childCounts.get(r.kltId) ?? 0,
    color: r.color,
    icon: r.icon,
  }));

  const placed = new Set(nodeRows.map((r) => r.kltId));
  const unplacedByKltId = new Map<string, UnplacedConcept>();
  for (const l of links) {
    if (placed.has(l.kltId)) continue;
    if (unplacedByKltId.has(l.kltId)) continue;
    unplacedByKltId.set(l.kltId, {
      kltId: l.kltId,
      name: l.klt.name,
      normalizedName: l.klt.normalizedName,
      linkCount: linkCounts.get(l.kltId) ?? 0,
    });
  }

  return {
    success: true,
    data: {
      setId: access.setId,
      setTitle: access.setTitle,
      nodes,
      unplaced: [...unplacedByKltId.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/**
 * Create a concept node by hand — the half of "seed the top rungs" that no AI
 * call provides.
 *
 * Two tables, two different scopes, in one transaction:
 *
 * - `Klt` is upserted by `normalizedName`, which is GLOBALLY unique. Typing a
 *   name another set already uses REUSES that concept rather than forking a
 *   near-duplicate — that shared vocabulary is what makes cross-set rollup
 *   and any future comparison mean anything (spec §2).
 * - `SetKltNode` places that concept in THIS set, and only this set. Which is
 *   why the same name in a DIFFERENT set is not a duplicate and must succeed:
 *   the concept is shared, the placement is not.
 *
 * Refuses, in order: a name `parseKltName` rejects; a `parentKltId` with no
 * node in this set; a resulting depth at or past `MAX_TREE_DEPTH`; a concept
 * that already has a node in this set. The last check lives INSIDE the
 * transaction, so a duplicate rolls back the `Klt` upsert rather than leaving
 * a fresh, unreferenced concept behind in the global vocabulary.
 */
export async function createConcept(
  setId: string,
  name: string,
  parentKltId: string | null,
): Promise<ActionResult<{ kltId: string }>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const parsed = parseKltName(name);
  if (!parsed) return { success: false, error: 'Invalid concept name' };

  let parent: TreeNodeRow | null = null;
  if (parentKltId !== null) {
    const rows = await loadSetTree(access.setId);
    parent = rows.find((r) => r.kltId === parentKltId) ?? null;
    // Not "unknown concept": a concept can exist globally, and even be placed
    // in another set, and still be an illegal parent here. `SetKltNode`
    // carries no foreign key on `parentKltId` precisely because an FK would
    // point at `Klt` and wrongly permit exactly this — so the check is code.
    if (!parent) {
      return { success: false, error: 'That parent has no place in this set' };
    }
  }

  const depth = parent ? parent.depth + 1 : 0;
  const ancestorIds = parent ? [...parent.ancestorIds, parent.kltId] : [];
  // Refused WHOLE, never trimmed to fit — a concept silently re-anchored
  // shallower than asked is a different concept in a different place.
  if (depth >= MAX_TREE_DEPTH) {
    return { success: false, error: `Nesting is capped at ${MAX_TREE_DEPTH} levels` };
  }

  const DUPLICATE = 'klt/duplicate-in-set';
  try {
    const kltId = await prisma.$transaction(async (tx) => {
      const klt = await tx.klt.upsert({
        where: { normalizedName: parsed.normalizedName },
        create: { name: parsed.name, normalizedName: parsed.normalizedName },
        update: {},
        select: { id: true },
      });
      const existing = await tx.setKltNode.findUnique({
        where: { setId_kltId: { setId: access.setId, kltId: klt.id } },
        select: { id: true },
      });
      if (existing) throw new Error(DUPLICATE);
      await tx.setKltNode.create({
        data: { setId: access.setId, kltId: klt.id, parentKltId, depth, ancestorIds },
      });
      return klt.id;
    });
    return { success: true, data: { kltId } };
  } catch (err) {
    if (err instanceof Error && err.message === DUPLICATE) {
      return { success: false, error: 'That concept is already in this set' };
    }
    return { success: false, error: 'Unable to create concept' };
  }
}

/**
 * Move `kltId` (and its whole subtree) under `newParentKltId` (or to a root
 * within this set, when null).
 *
 * `computeSubtreeUpdates` does the depth/ancestor arithmetic against THIS
 * SET's rows only, and throws on a cycle, an unknown node, an unknown parent,
 * or a `MAX_TREE_DEPTH` breach. That throw is caught and turned into a failed
 * `ActionResult` before any transaction opens; it must never escape as a raw
 * exception.
 */
export async function reparentConcept(
  setId: string,
  kltId: string,
  newParentKltId: string | null,
): Promise<ActionResult<null>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const rows = await loadSetTree(access.setId);
  const node = rows.find((r) => r.kltId === kltId);
  if (!node) return { success: false, error: 'Concept not found in this set' };

  let updates: { id: string; depth: number; ancestorIds: string[] }[];
  try {
    updates = computeSubtreeUpdates(kltId, newParentKltId, rows);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unable to move concept' };
  }

  await prisma.$transaction(async (tx) => {
    await applySubtreeMove(tx, node.id, newParentKltId, updates);
  });

  return { success: true, data: null };
}

/**
 * Rename the concept `kltId`.
 *
 * THIS ONE EDIT IS NOT SET-SCOPED, and deliberately: `Klt` is the shared
 * vocabulary, so a rename changes the name everywhere the concept appears.
 * It changes no STRUCTURE anywhere — not one `SetKltNode` row is touched, so
 * no other set's hierarchy, and no learner's mastery, moves. The editor's
 * copy says exactly this rather than leaving it to be discovered.
 *
 * NARROWED per the controller ruling on this task: renaming the shared
 * vocabulary is itself a cross-set-visible write (every set that shows this
 * concept's name sees the new one), which reads as exactly the multi-set
 * edit Decision 4 forbids for an ordinary owner. So a non-allowlisted caller
 * may rename ONLY when the concept is not reachable from any set they do not
 * own — every `SetKltNode` placing it, and every `KlpTopic` citing it via
 * `klp -> card -> set`, must belong to a set THEY own. When some other set
 * also places or cites it, the name is genuinely shared and only an operator
 * (`viaAllowlist`) may change it; the failure says so rather than pretending
 * the concept does not exist, since the caller already proved they may see
 * it (it is in their own set).
 *
 * Still gated per set, and still requires the concept to be IN this set
 * (placed, or cited by its cards) — an owner may rename what their own deck
 * uses, never an arbitrary concept out of the global registry.
 */
export async function renameConcept(
  setId: string,
  kltId: string,
  name: string,
): Promise<ActionResult<null>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const parsed = parseKltName(name);
  if (!parsed) return { success: false, error: 'Invalid concept name' };

  const inSet = await isConceptInSet(access.setId, kltId);
  if (!inSet) return { success: false, error: 'Concept not found in this set' };

  if (!access.viaAllowlist) {
    const sharedElsewhere = await isConceptUsedOutsideOwnedSets(access.userId, kltId);
    if (sharedElsewhere) {
      return {
        success: false,
        error:
          'This concept name is shared with a set you do not own. An operator can rename it from the admin editor.',
      };
    }
  }

  const collision = await prisma.klt.findFirst({
    where: { normalizedName: parsed.normalizedName, NOT: { id: kltId } },
    select: { id: true },
  });
  if (collision) {
    return { success: false, error: 'Another concept already has that name — merge instead' };
  }

  await prisma.klt.update({
    where: { id: kltId },
    data: { name: parsed.name, normalizedName: parsed.normalizedName },
  });

  return { success: true, data: null };
}

/**
 * Does any set THIS CALLER DOES NOT OWN place or cite `kltId`?
 *
 * Two independent reach paths, checked with `NOT: { userId }` (not `userId:
 * { not: userId }` against a nullable column — `Set.userId` is required, so
 * either form is safe here, but `NOT` on the relation keeps this readable
 * next to `isConceptInSet`'s shape): a `SetKltNode` placing the concept in
 * another owner's set, or a `KlpTopic` citing it via that set's own cards.
 * Either one existing means the concept is not this caller's alone to rename.
 */
async function isConceptUsedOutsideOwnedSets(userId: string, kltId: string): Promise<boolean> {
  const [nodeElsewhere, linkElsewhere] = await Promise.all([
    prisma.setKltNode.findFirst({
      where: { kltId, set: { NOT: { userId } } },
      select: { id: true },
    }),
    prisma.klpTopic.findFirst({
      where: { kltId, klp: { card: { set: { NOT: { userId } } } } },
      select: { id: true },
    }),
  ]);
  return nodeElsewhere !== null || linkElsewhere !== null;
}

/**
 * Is this concept part of this set at all — placed, or merely cited?
 *
 * Two queries rather than one because the two facts are genuinely different:
 * a concept sitting in the tree, and a concept this set's cards mention but
 * which has never been placed. Rename is legitimate for both.
 */
async function isConceptInSet(setId: string, kltId: string): Promise<boolean> {
  const [node, link] = await Promise.all([
    prisma.setKltNode.findUnique({
      where: { setId_kltId: { setId, kltId } },
      select: { id: true },
    }),
    prisma.klpTopic.findFirst({
      where: { kltId, klp: { card: { setId } } },
      select: { id: true },
    }),
  ]);
  return node !== null || link !== null;
}

/**
 * Fold `sourceKltId` into `targetKltId` WITHIN THIS SET.
 *
 * Three set-scoped writes, one transaction:
 *   1. this set's `KlpTopic` rows move from source to target (skipping any
 *      that would duplicate an existing `(klpId, kltId)` pair, which
 *      `@@unique([klpId, kltId])` would reject);
 *   2. the source's children IN THIS SET are re-pointed to the target with
 *      their subtrees recomputed;
 *   3. the source's `SetKltNode` row — this set's placement, nothing more —
 *      is deleted.
 *
 * THE GLOBAL `Klt` ROW IS NEVER DELETED. It would cascade
 * (`SetKltNode.klt` is `onDelete: Cascade`) into every OTHER set's placement
 * of that concept — one merge silently unplacing a stranger's tree. That is
 * precisely the cross-set write Decision 4 forbids, so the source concept
 * survives in the vocabulary and simply stops being placed here.
 *
 * Refuses when the target is a descendant of the source, or is the source:
 * `wouldCycle` catches both.
 *
 * Touches no `CardKlp`, no `KlpState`, no `AnswerKlpResult`. A `KlpTopic` row
 * records which concept a key point cites; re-pointing one carries no answer
 * history with it, and the key point itself is never superseded or deleted.
 */
export async function mergeConcepts(
  setId: string,
  sourceKltId: string,
  targetKltId: string,
): Promise<ActionResult<null>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const rows = await loadSetTree(access.setId);
  const byKltId = new Map(rows.map((r) => [r.kltId, r]));

  const source = byKltId.get(sourceKltId);
  const target = byKltId.get(targetKltId);
  if (!source || !target) {
    return { success: false, error: 'Concept not found in this set' };
  }
  if (sourceKltId === targetKltId || wouldCycle(sourceKltId, targetKltId, byKltId)) {
    return { success: false, error: 'Cannot merge a concept into itself or its own descendant' };
  }

  const children = rows.filter((r) => r.parentKltId === sourceKltId);

  // `target` cannot be a descendant of `source` (refused above), so moving
  // `source`'s children under it can never introduce a cycle. It CAN still
  // breach MAX_TREE_DEPTH, and `computeSubtreeUpdates` throws on that —
  // caught here, before any transaction opens, exactly as `reparentConcept`
  // handles the identical throw from the same function.
  const childUpdatesById = new Map<string, { id: string; depth: number; ancestorIds: string[] }[]>();
  try {
    for (const child of children) {
      childUpdatesById.set(child.id, computeSubtreeUpdates(child.kltId, targetKltId, rows));
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unable to merge concepts' };
  }

  await prisma.$transaction(async (tx) => {
    // Read inside the transaction, not before it opens, so the duplicate-link
    // skip decision below is computed atomically with the write acting on it.
    // Both reads are filtered by `klp.card.setId` — another set's links to
    // the same two concepts are neither read nor moved.
    const [sourceLinks, targetLinks] = await Promise.all([
      tx.klpTopic.findMany({
        where: { kltId: sourceKltId, klp: { card: { setId: access.setId } } },
        select: { id: true, klpId: true },
      }),
      tx.klpTopic.findMany({
        where: { kltId: targetKltId, klp: { card: { setId: access.setId } } },
        select: { klpId: true },
      }),
    ]);
    const targetKlpIds = new Set(targetLinks.map((l) => l.klpId));

    for (const link of sourceLinks) {
      // This link's key point already cites the TARGET (a separate KlpTopic
      // row for the same klpId exists there), so re-pointing this row would
      // duplicate the (klpId, targetKltId) pair `@@unique` rejects. DELETE
      // the source row rather than leaving it in place: the fact it recorded
      // — "this key point cites this concept" — already exists via the
      // target's own row, so nothing is lost. Leaving it behind was the
      // bug: the source `SetKltNode` is deleted below, but this dangling
      // `KlpTopic` row still cites `sourceKltId` in this set, so
      // `listConceptTree` reads it back as an unplaced link and the
      // merged-away concept resurrects in the "Unplaced" section as though
      // the merge never happened.
      if (targetKlpIds.has(link.klpId)) {
        await tx.klpTopic.delete({ where: { id: link.id } });
        continue;
      }
      await tx.klpTopic.update({ where: { id: link.id }, data: { kltId: targetKltId } });
    }

    for (const child of children) {
      await applySubtreeMove(tx, child.id, targetKltId, childUpdatesById.get(child.id)!);
    }

    // This set's placement only. The `Klt` row is untouched — see the doc.
    await tx.setKltNode.delete({ where: { id: source.id } });
  });

  return { success: true, data: null };
}

/**
 * Remove `kltId` from THIS SET's tree.
 *
 * Deletes the `SetKltNode` row, never the `Klt`: the concept stays in the
 * vocabulary, stays cited by whichever key points cite it, and simply becomes
 * unplaced here — which is why the editor lists it again under "Unplaced"
 * rather than losing it. Deleting the `Klt` would cascade into every other
 * set's placement of it, and `CardKlp` is never touched either way.
 *
 * Refused while the node still has children IN THIS SET — orphaning a subtree
 * is the silent failure this editor exists to prevent, and unlike the old
 * global tree there is no `onDelete: Restrict` to fall back on: `SetKltNode`
 * carries no foreign key on `parentKltId`, so this check is the ONLY thing
 * standing between a delete and a set full of orphans.
 */
export async function deleteConcept(setId: string, kltId: string): Promise<ActionResult<null>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const node = await prisma.setKltNode.findUnique({
    where: { setId_kltId: { setId: access.setId, kltId } },
    select: { id: true },
  });
  if (!node) return { success: false, error: 'Concept not found in this set' };

  const childCount = await prisma.setKltNode.count({
    where: { setId: access.setId, parentKltId: kltId },
  });
  if (childCount > 0) {
    return { success: false, error: 'Cannot delete a concept that still has children' };
  }

  await prisma.setKltNode.delete({ where: { id: node.id } });

  return { success: true, data: null };
}


/**
 * Set (or clear) one node's display colour and icon IN THIS SET.
 *
 * Purely cosmetic and purely set-scoped — it writes two nullable columns on
 * one `SetKltNode` row. No `Klt`, no `KlpTopic`, no structure: unlike
 * `renameConcept`, which edits the SHARED vocabulary and is therefore narrowed
 * to operators when a concept is used elsewhere, styling the same concept
 * differently in two sets is not a conflict, it is the point.
 *
 * `undefined` leaves a field alone, `null` clears it — so the picker can drop
 * a colour back to "inherit from my branch" without also wiping the icon.
 * Both are validated against the shared key lists rather than stored as free
 * text: an arbitrary value would render as the fallback anyway, so accepting
 * it would only mean silently losing the user's choice.
 */
export async function setNodeStyle(
  setId: string,
  kltId: string,
  style: { color?: string | null; icon?: string | null },
): Promise<ActionResult<null>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  if (style.color !== undefined && style.color !== null && !isNodeColorKey(style.color)) {
    return { success: false, error: 'Unknown colour' };
  }
  if (style.icon !== undefined && style.icon !== null && !isNodeIconKey(style.icon)) {
    return { success: false, error: 'Unknown icon' };
  }

  const node = await prisma.setKltNode.findUnique({
    where: { setId_kltId: { setId: access.setId, kltId } },
    select: { id: true },
  });
  if (!node) return { success: false, error: 'Concept not found in this set' };

  await prisma.setKltNode.update({
    where: { id: node.id },
    data: { color: style.color, icon: style.icon },
  });

  return { success: true, data: null };
}
