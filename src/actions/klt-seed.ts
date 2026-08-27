'use server';

import { requireSetKltAccess } from '@/lib/klt/access';
import { listConceptTree } from '@/actions/klt-tree';
import { applyPaths } from '@/lib/klt/structure';
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
 * Gated here, then delegates the actual mechanics to `applyPaths`
 * (`src/lib/klt/structure.ts`, shared with Task 5's presets) — a plain
 * library function, not a server action, precisely so it cannot be called
 * directly with an arbitrary `setId`. This wrapper is what resolves and
 * enforces access before that shared code ever runs.
 *
 * REUSES `resolvePlacementPath` (inside `applyPaths`) rather than
 * reinventing reconciliation — it already refuses a path whose match follows
 * a creation (which would silently re-parent an existing node and move its
 * subtree's mastery), a repeated name, an over-deep path, and a segment
 * failing `parseKltName`. A `null` result is honoured by skipping that path
 * outright, never worked around: fabricating a placement here is exactly the
 * failure mode the whole placement pipeline exists to avoid. `byNormalized`
 * (and therefore what counts as "already exists") is seeded from
 * `loadSetTree(setId)` — THIS SET's placed nodes only, so a chain segment
 * that happens to share a name with another set's structure is still
 * created fresh here rather than silently adopting that other set's
 * placement.
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

  const data = await applyPaths(access.setId, paths, MAX_SKELETON_DEPTH);
  return { success: true, data };
}
