'use server';

import { prisma } from '@/lib/db';
import { requireSetKltAccess } from '@/lib/klt/access';
import { listConceptTree, loadSetTree } from '@/actions/klt-tree';
import { resolvePlacementPath, type ResolvedPlacement } from '@/lib/klt/place';
import type { TreeNodeRow } from '@/lib/klt/tree';
import { generateJson } from '@/lib/ai/generate';
import { SUGGEST_SKELETON_PROMPT } from '@/lib/ai/prompts/suggest-skeleton';
import { KltSkeletonSchema, MAX_SKELETON_DEPTH } from '@/lib/ai/schemas';
import { parseKltName } from '@/lib/klt/normalize';
import type { ActionResult } from '@/types/action';

/**
 * How many of this SET's own unplaced concepts to show the AI as evidence of
 * what the set covers. Large enough to give a real sense of the material's
 * shape, small enough that the prompt stays a sample, not a data dump —
 * placement (a different prompt entirely) is what reads the full tree.
 */
const SAMPLE_SIZE = 40;

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' };

/**
 * Suggest the top 2-3 rungs of `subject`'s hierarchy for THIS SET, using a
 * sample of this set's own unplaced concepts as evidence of what it covers.
 *
 * Scoped to `setId` (the last write path this migration moves off the
 * deprecated global `Klt.parentKltId`/`depth`/`ancestorIds` columns): the
 * sample is drawn from `listConceptTree(setId)`'s `unplaced` list, which is
 * already filtered to concepts THIS SET's cards cite — a concept some other
 * set extracted is never shown as evidence for this one.
 *
 * WRITES NOTHING. This is the whole point (spec §5.2): a skeleton is the
 * structure every later placement inherits, so an unreviewed one is expensive
 * (it reshapes the whole tree) and silent (nobody chose it). The caller must
 * review the returned paths and pass the ones it wants to `applySkeleton`
 * explicitly — this function only ever reads.
 */
export async function suggestSkeleton(
  setId: string,
  subject: string,
): Promise<ActionResult<{ paths: string[][] }>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const parsedSubject = parseKltName(subject);
  if (!parsedSubject) return { success: false, error: 'Invalid subject name' };

  const tree = await listConceptTree(access.setId);
  if (!tree.success) return { success: false, error: 'Unable to read this set’s concepts' };

  const sampleConcepts = tree.data.unplaced.slice(0, SAMPLE_SIZE).map((n) => n.name);

  let result: { paths: string[][] };
  try {
    result = await generateJson({
      userId: access.userId,
      task: 'autocomplete',
      prompt: SUGGEST_SKELETON_PROMPT.build({ subject: parsedSubject.name, sampleConcepts }),
      schema: KltSkeletonSchema,
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unable to suggest a skeleton' };
  }

  return { success: true, data: result };
}

/**
 * Create the missing chain for each accepted path, IN THIS SET.
 *
 * REUSES `resolvePlacementPath` rather than reinventing reconciliation — it
 * already refuses a path whose match follows a creation (which would
 * silently re-parent an existing node and move its subtree's mastery), a
 * repeated name, an over-deep path, and a segment failing `parseKltName`. A
 * `null` result is honoured by skipping that path outright, never worked
 * around: fabricating a placement here is exactly the failure mode the whole
 * placement pipeline exists to avoid. `byNormalized` (and therefore what
 * counts as "already exists") is seeded from `loadSetTree(setId)` — THIS
 * SET's placed nodes only, so a chain segment that happens to share a name
 * with another set's structure is still created fresh here rather than
 * silently adopting that other set's placement.
 *
 * Also enforces `MAX_SKELETON_DEPTH` directly, independent of
 * `resolvePlacementPath`'s own (much looser) `MAX_TREE_DEPTH` cap — a
 * skeleton is top rungs only, by definition, regardless of how much room the
 * tree has left.
 *
 * IDEMPOTENT: a path whose every segment already exists in this set resolves
 * to `toCreate.length === 0` — nothing was refused, the concept is simply
 * already there, so this does NOT count toward `skipped` below.
 *
 * `skipped` counts only paths that were REFUSED (too deep, empty, or a
 * `resolvePlacementPath` null — e.g. one that would re-parent an existing
 * node). Skipping a bad path rather than failing the whole call is right —
 * one bad path should not discard an otherwise good skeleton — but doing so
 * silently is not: a caller that only sees `created` never learns some
 * rungs were refused. The UI surfaces both numbers ("Applied N, skipped M").
 */
export async function applySkeleton(
  setId: string,
  paths: string[][],
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const rows = await loadSetTree(access.setId);
  const byNormalized = new Map(rows.map((r) => [r.normalizedName, r]));

  let created = 0;
  let skipped = 0;
  for (const path of paths) {
    if (path.length === 0 || path.length > MAX_SKELETON_DEPTH) {
      skipped++;
      continue;
    }

    const resolved = resolvePlacementPath(path, byNormalized);
    if (!resolved) {
      skipped++;
      continue;
    }
    if (resolved.toCreate.length === 0) continue;

    created += await createChain(access.setId, resolved, byNormalized);
  }

  return { success: true, data: { created, skipped } };
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
