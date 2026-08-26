'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isKltEditor } from '@/lib/klt/editors';
import { computeSubtreeUpdates, wouldCycle, type TreeNodeRow } from '@/lib/klt/tree';
import { parseKltName } from '@/lib/klt/normalize';
import type { ActionResult } from '@/types/action';

/**
 * A node in the global concept tree, as the editor screen renders it.
 *
 * `linkCount` is how many `CardKlp`s cite this concept (via `KlpTopic`);
 * `childCount` is how many other `Klt` rows are parented here. Neither
 * number is fetched to enforce anything below — `deleteConcept` reasons
 * about children with its own count query, not this one — they exist purely
 * for the screen to render "this node has N links / M children".
 */
export interface ConceptTreeNode {
  id: string;
  name: string;
  normalizedName: string;
  parentKltId: string | null;
  depth: number;
  ancestorIds: string[];
  linkCount: number;
  childCount: number;
}

const KLT_ROW_SELECT = {
  id: true,
  name: true,
  normalizedName: true,
  parentKltId: true,
  depth: true,
  ancestorIds: true,
} as const;

/**
 * Every action here is gated by this same check. The tree is GLOBAL — there
 * is no owner to compare against — so authorization is an operator-configured
 * allowlist (`KLT_EDITORS`), not a per-row permission.
 *
 * Returns the userId on success, null otherwise. Callers turn null into a
 * not-found `ActionResult`, never a "forbidden" one: telling an unauthorized
 * caller that this route exists at all is information they should not have.
 */
async function requireEditor(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !isKltEditor(userId)) return null;
  return userId;
}

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' };

/**
 * Write one subtree move (a node plus every descendant `computeSubtreeUpdates`
 * flagged as changed) inside an already-open transaction.
 *
 * `parentKltId` is only ever included for `nodeId` itself — every other row
 * in `updates` is a descendant whose OWN `parentKltId` does not change, only
 * its denormalized `depth`/`ancestorIds` do.
 */
async function applySubtreeMove(
  tx: { klt: { update: typeof prisma.klt.update } },
  nodeId: string,
  newParentId: string | null,
  updates: { id: string; depth: number; ancestorIds: string[] }[],
): Promise<void> {
  for (const u of updates) {
    await tx.klt.update({
      where: { id: u.id },
      data: {
        parentKltId: u.id === nodeId ? newParentId : undefined,
        depth: u.depth,
        ancestorIds: u.ancestorIds,
      },
    });
  }
}

/** The whole tree, for the editor screen to render. */
export async function listConceptTree(): Promise<ActionResult<ConceptTreeNode[]>> {
  const userId = await requireEditor();
  if (!userId) return NOT_FOUND;

  const rows = await prisma.klt.findMany({
    select: {
      ...KLT_ROW_SELECT,
      _count: { select: { links: true, children: true } },
    },
  });

  const data: ConceptTreeNode[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    normalizedName: r.normalizedName,
    parentKltId: r.parentKltId,
    depth: r.depth,
    ancestorIds: r.ancestorIds,
    linkCount: r._count.links,
    childCount: r._count.children,
  }));

  return { success: true, data };
}

/**
 * Move `kltId` (and its whole subtree) under `newParentId` (or to root, when
 * null).
 *
 * `computeSubtreeUpdates` does the actual depth/ancestor arithmetic and
 * throws on a cycle or a `MAX_TREE_DEPTH` breach — that throw is caught
 * here and turned into a failed `ActionResult`; it must never escape to the
 * caller as a raw exception.
 */
export async function reparentConcept(
  kltId: string,
  newParentId: string | null,
): Promise<ActionResult<null>> {
  const userId = await requireEditor();
  if (!userId) return NOT_FOUND;

  const rows = (await prisma.klt.findMany({ select: KLT_ROW_SELECT })) as TreeNodeRow[];

  let updates: { id: string; depth: number; ancestorIds: string[] }[];
  try {
    updates = computeSubtreeUpdates(kltId, newParentId, rows);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unable to move concept' };
  }

  await prisma.$transaction(async (tx) => {
    await applySubtreeMove(tx, kltId, newParentId, updates);
  });

  return { success: true, data: null };
}

/**
 * Rename `kltId`. Validates with `parseKltName`, then refuses if another row
 * already holds that `normalizedName` — renaming never silently merges two
 * concepts; the user can merge explicitly with `mergeConcepts`.
 */
export async function renameConcept(kltId: string, name: string): Promise<ActionResult<null>> {
  const userId = await requireEditor();
  if (!userId) return NOT_FOUND;

  const parsed = parseKltName(name);
  if (!parsed) return { success: false, error: 'Invalid concept name' };

  const existing = await prisma.klt.findUnique({ where: { id: kltId }, select: { id: true } });
  if (!existing) {
    return { success: false, error: 'Concept not found' };
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
 * Fold `sourceId` into `targetId`: `KlpTopic` rows move to the target
 * (skipping any that would duplicate an existing `(klpId, targetId)` pair —
 * `@@unique([klpId, kltId])` would otherwise reject the write), `source`'s
 * children are re-pointed to the target with their subtrees recomputed, and
 * `source` itself is deleted. All in one transaction.
 *
 * Refuses when `target` is a descendant of `source` — that would either be a
 * cycle (merging into a leaf that only exists under `source`) or a no-op
 * self-merge, and `wouldCycle` catches both.
 *
 * This never touches `CardKlp`, `KlpState` or `AnswerKlpResult`: a `Klt`'s
 * `KlpTopic` rows carry no answer history, only which concept a key point
 * cites, and `CardKlp` itself is never superseded or deleted here.
 */
export async function mergeConcepts(sourceId: string, targetId: string): Promise<ActionResult<null>> {
  const userId = await requireEditor();
  if (!userId) return NOT_FOUND;

  const rows = (await prisma.klt.findMany({ select: KLT_ROW_SELECT })) as TreeNodeRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  if (!byId.has(sourceId) || !byId.has(targetId)) {
    return { success: false, error: 'Concept not found' };
  }
  if (sourceId === targetId || wouldCycle(sourceId, targetId, byId)) {
    return { success: false, error: 'Cannot merge a concept into itself or its own descendant' };
  }

  const [sourceLinks, targetLinks] = await Promise.all([
    prisma.klpTopic.findMany({ where: { kltId: sourceId }, select: { id: true, klpId: true } }),
    prisma.klpTopic.findMany({ where: { kltId: targetId }, select: { klpId: true } }),
  ]);
  const targetKlpIds = new Set(targetLinks.map((l) => l.klpId));
  const children = rows.filter((r) => r.parentKltId === sourceId);

  await prisma.$transaction(async (tx) => {
    for (const link of sourceLinks) {
      // Skip: re-pointing this one would duplicate an existing
      // (klpId, targetId) pair. The row itself is not orphaned — it cascades
      // away with `source` at the end of this transaction, which is fine:
      // the target already carries that link.
      if (targetKlpIds.has(link.klpId)) continue;
      await tx.klpTopic.update({ where: { id: link.id }, data: { kltId: targetId } });
    }

    for (const child of children) {
      // `target` cannot be a descendant of `source` (refused above), so it
      // cannot be a descendant of any of `source`'s children either — this
      // move can never introduce a cycle of its own.
      const childUpdates = computeSubtreeUpdates(child.id, targetId, rows);
      await applySubtreeMove(tx, child.id, targetId, childUpdates);
    }

    await tx.klt.delete({ where: { id: sourceId } });
  });

  return { success: true, data: null };
}

/**
 * Delete `kltId`. Refused while it still has children — orphaning a subtree
 * is the silent failure this editor exists to prevent. (`Klt.parent` is also
 * `onDelete: Restrict`, so the database refuses too, but a checked count
 * gives a clear `ActionResult` instead of a raw Prisma exception.)
 */
export async function deleteConcept(kltId: string): Promise<ActionResult<null>> {
  const userId = await requireEditor();
  if (!userId) return NOT_FOUND;

  const childCount = await prisma.klt.count({ where: { parentKltId: kltId } });
  if (childCount > 0) {
    return { success: false, error: 'Cannot delete a concept that still has children' };
  }

  await prisma.klt.delete({ where: { id: kltId } });

  return { success: true, data: null };
}
