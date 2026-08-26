'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isKltEditor } from '@/lib/klt/editors';
import { resolvePlacementPath, type ResolvedPlacement } from '@/lib/klt/place';
import type { TreeNodeRow } from '@/lib/klt/tree';
import { generateJson } from '@/lib/ai/generate';
import { SUGGEST_SKELETON_PROMPT } from '@/lib/ai/prompts/suggest-skeleton';
import { KltSkeletonSchema, MAX_SKELETON_DEPTH } from '@/lib/ai/schemas';
import { parseKltName } from '@/lib/klt/normalize';
import type { ActionResult } from '@/types/action';

/**
 * How many already-extracted leaf concepts to show the AI as evidence of
 * what a subject covers. Large enough to give a real sense of the material's
 * shape, small enough that the prompt stays a sample, not a data dump —
 * placement (a different prompt entirely) is what reads the full tree.
 */
const SAMPLE_SIZE = 40;

const KLT_ROW_SELECT = {
  id: true,
  name: true,
  normalizedName: true,
  parentKltId: true,
  depth: true,
  ancestorIds: true,
} as const;

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' };

/**
 * Same gate as `src/actions/klt-tree.ts`: the tree is GLOBAL, so authorization
 * is an operator-configured allowlist, not a per-row permission. Returns null
 * on any failure so both callers here turn it into a not-found `ActionResult`
 * — never "forbidden", which would tell an unauthorized caller this route
 * exists at all.
 */
async function requireEditor(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !isKltEditor(userId)) return null;
  return userId;
}

/**
 * Suggest the top 2-3 rungs of `subject`'s hierarchy, using a sample of leaf
 * concepts already extracted from the learner's cards as evidence of what it
 * covers.
 *
 * WRITES NOTHING. This is the whole point (spec §5.2): a skeleton is the
 * structure every later placement inherits, so an unreviewed one is expensive
 * (it reshapes the whole tree) and silent (nobody chose it). The caller must
 * review the returned paths and pass the ones it wants to `applySkeleton`
 * explicitly — this function only ever reads.
 */
export async function suggestSkeleton(subject: string): Promise<ActionResult<{ paths: string[][] }>> {
  const userId = await requireEditor();
  if (!userId) return NOT_FOUND;

  const parsedSubject = parseKltName(subject);
  if (!parsedSubject) return { success: false, error: 'Invalid subject name' };

  const rows = (await prisma.klt.findMany({ select: KLT_ROW_SELECT })) as TreeNodeRow[];

  // Same "unplaced leaf" definition `placeUnparentedConcepts` uses: a node
  // with no parent AND no children. A root already has a home; a node with
  // children is structure, not a leaf sample.
  const hasChildren = new Set(rows.map((n) => n.parentKltId).filter((id): id is string => id !== null));
  const unplaced = rows.filter((n) => n.parentKltId === null && !hasChildren.has(n.id));
  const sampleConcepts = unplaced.slice(0, SAMPLE_SIZE).map((n) => n.name);

  let result: { paths: string[][] };
  try {
    result = await generateJson({
      userId,
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
 * Create the missing chain for each accepted path.
 *
 * REUSES `resolvePlacementPath` rather than reinventing reconciliation — it
 * already refuses a path whose match follows a creation (which would
 * silently re-parent an existing node and move its subtree's mastery), a
 * repeated name, an over-deep path, and a segment failing `parseKltName`.
 * A `null` result is honoured by skipping that path outright, never worked
 * around: fabricating a placement here is exactly the failure mode the whole
 * placement pipeline exists to avoid.
 *
 * Also enforces `MAX_SKELETON_DEPTH` directly, independent of
 * `resolvePlacementPath`'s own (much looser) `MAX_TREE_DEPTH` cap — a
 * skeleton is top rungs only, by definition, regardless of how much room the
 * tree has left.
 *
 * IDEMPOTENT: a path whose every segment already exists resolves to
 * `toCreate.length === 0` — nothing was refused, the concept is simply
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
  paths: string[][],
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const userId = await requireEditor();
  if (!userId) return NOT_FOUND;

  const rows = (await prisma.klt.findMany({ select: KLT_ROW_SELECT })) as TreeNodeRow[];
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

    created += await createChain(resolved, byNormalized);
  }

  return { success: true, data: { created, skipped } };
}

/**
 * Create every missing segment of one resolved path, in order, each a child
 * of the previous — the parent chain and the final segment alike, unlike
 * `place.ts`'s `applyPlacement` (which treats its last segment as an
 * EXISTING unplaced node to attach, not a node to create). A skeleton has no
 * pre-existing leaf to attach: every `toCreate` entry here is new structure.
 *
 * `upsert` (not `create`) so a concurrent or repeated call converges on the
 * same row instead of racing to create a duplicate `normalizedName`.
 * `byNormalized` is updated in place as each segment is created so the NEXT
 * segment in the same path — and any later path in the same call — can chain
 * off it instead of re-resolving against a stale snapshot.
 */
async function createChain(
  resolved: ResolvedPlacement,
  byNormalized: Map<string, TreeNodeRow>,
): Promise<number> {
  let parent = resolved.matched[resolved.matched.length - 1] ?? null;
  let count = 0;

  await prisma.$transaction(async (tx) => {
    for (const spec of resolved.toCreate) {
      const node = await tx.klt.upsert({
        where: { normalizedName: spec.normalizedName },
        create: {
          name: spec.name,
          normalizedName: spec.normalizedName,
          parentKltId: parent?.id ?? null,
          depth: parent ? parent.depth + 1 : 0,
          ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
        },
        update: {},
        select: KLT_ROW_SELECT,
      });
      byNormalized.set(node.normalizedName, node);
      parent = node;
      count++;
    }
  });

  return count;
}
