'use server';

/**
 * Reusable structure presets (spec §3b) — a named, admin-authored list of
 * root-to-node paths that any set owner can apply to seed their own tree,
 * instead of typing top rungs by hand or waiting on an AI suggestion every
 * time. Built on the same primitives Task 4's AI seeding already uses:
 *
 * - Paths store concept NAMES, never ids (`KltPreset.paths`), so a preset
 *   applies cleanly to a set whose concepts do not exist yet — see the
 *   model's own doc comment in `prisma/schema.prisma`.
 * - Applying routes through `applyPaths` (`src/lib/klt/structure.ts`), the
 *   SAME function `applySkeleton` uses, which in turn calls
 *   `resolvePlacementPath` for every path. A path that would re-parent an
 *   existing node is refused there, not honoured — this module never
 *   second-guesses that refusal or works around it.
 * - Authoring (`savePreset`/`deletePreset`) is `KLT_EDITORS`-only: a preset
 *   is shared, install-wide structure, the same operator capability as the
 *   global concept tree used to be before Decision 4 split editing per set.
 *   Applying, by contrast, is per-set and open to that set's own owner (or an
 *   operator) via `requireSetKltAccess` — exactly Decision 4's split between
 *   "who may see/apply shared structure" and "who may author it".
 * - Decision 7: nothing here is ever auto-applied. `applyPreset` only runs
 *   when a set owner explicitly picks a preset and clicks Apply.
 */
import { prisma } from '@/lib/db';
import { auth } from '@/auth';
import { isKltEditor } from '@/lib/klt/editors';
import { requireSetKltAccess } from '@/lib/klt/access';
import { loadSetTree, applyPaths } from '@/lib/klt/structure';
import { parseKltName } from '@/lib/klt/normalize';
import type { TreeNodeRow } from '@/lib/klt/tree';
import type { ActionResult } from '@/types/action';

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' };

export interface KltPresetSummary {
  id: string;
  name: string;
  pathCount: number;
}

/**
 * Is the current session an operator? A plain `auth()` + `isKltEditor` check
 * — unlike every action in `klt-tree.ts`/`klt-seed.ts`, preset AUTHORING
 * (`savePreset`/`deletePreset`) has no `setId` to resolve access against: a
 * preset is not scoped to any one set, so there is no `requireSetKltAccess`
 * call to make here. `savePresetFromSet` is the exception — it DOES have a
 * set in view, and uses `requireSetKltAccess`'s own `viaAllowlist` instead
 * (see below), for the same reason `renameConcept` does: access should be
 * resolved once, from the database, not re-derived a second way.
 */
async function isCallerKltAdmin(): Promise<boolean> {
  const session = await auth();
  const userId = session?.user?.id;
  return !!userId && isKltEditor(userId);
}

/** Every segment of every path must still be a legal concept name. */
function pathsAreValid(paths: unknown): paths is string[][] {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  for (const path of paths) {
    if (!Array.isArray(path) || path.length === 0) return false;
    for (const segment of path) {
      if (typeof segment !== 'string' || !parseKltName(segment)) return false;
    }
  }
  return true;
}

/**
 * Every saved preset, for the "Apply a preset" picker. Gated the same way
 * applying is (`requireSetKltAccess`) rather than left wide open — a preset's
 * CONTENTS are shared structure, but who gets to see the picker at all is
 * still "someone with edit access to a set", same posture as every other
 * read in this feature.
 */
export async function listPresets(setId: string): Promise<ActionResult<KltPresetSummary[]>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const rows = await prisma.kltPreset.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, paths: true },
  });

  return {
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      pathCount: Array.isArray(r.paths) ? r.paths.length : 0,
    })),
  };
}

/**
 * Create or update a named preset. Admin-only.
 *
 * Validates every segment of every path with `parseKltName` — the SAME rule
 * `resolvePlacementPath` enforces at apply time, checked again here so a
 * preset an admin is trying to save right now is rejected immediately rather
 * than silently accepted and only refused later, path by path, when some
 * owner applies it.
 *
 * `upsert` on the unique `name`, not `create`: "save" is naturally
 * idempotent — re-saving under the same name (e.g. `savePresetFromSet`
 * updating an existing preset with the set's latest structure) replaces the
 * paths rather than erroring on a duplicate name.
 */
export async function savePreset(name: string, paths: string[][]): Promise<ActionResult<{ id: string }>> {
  if (!(await isCallerKltAdmin())) return NOT_FOUND;

  const trimmedName = name.trim();
  if (trimmedName.length === 0) return { success: false, error: 'Preset name is required' };

  if (!pathsAreValid(paths)) {
    return { success: false, error: 'Every path needs at least one valid concept name' };
  }

  const preset = await prisma.kltPreset.upsert({
    where: { name: trimmedName },
    create: { name: trimmedName, paths },
    update: { paths },
    select: { id: true },
  });

  return { success: true, data: { id: preset.id } };
}

/** Delete a preset by id. Admin-only. */
export async function deletePreset(id: string): Promise<ActionResult<null>> {
  if (!(await isCallerKltAdmin())) return NOT_FOUND;

  const existing = await prisma.kltPreset.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { success: false, error: 'Preset not found' };

  await prisma.kltPreset.delete({ where: { id } });
  return { success: true, data: null };
}

/**
 * Apply a saved preset to ONE set — the set owner, or an operator, via
 * `requireSetKltAccess`.
 *
 * Reuses `applyPaths` (`src/lib/klt/structure.ts`) unchanged: the SAME
 * `resolvePlacementPath` validation `applySkeleton` relies on, so a path that
 * would re-parent an existing node is refused and counted in `skipped`, not
 * honoured. No `maxPathLength` is passed — unlike a skeleton (top rungs
 * only), a preset may legitimately describe a set's WHOLE structure, so the
 * only cap is `resolvePlacementPath`'s own `MAX_TREE_DEPTH`.
 *
 * Segments are re-validated at apply time too (inside `resolvePlacementPath`,
 * via `parseKltName`): a preset saved before a naming rule tightened must not
 * bypass the CURRENT rule just because it passed the OLD one at save time. A
 * path with a now-invalid segment resolves to `null` and is skipped, exactly
 * like any other refused path.
 *
 * Idempotent for the same reason `applySkeleton` is: a path whose every
 * segment already exists in this set does no work and is not counted as
 * skipped either.
 */
export async function applyPreset(
  presetId: string,
  setId: string,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const access = await requireSetKltAccess(setId);
  if (!access) return NOT_FOUND;

  const preset = await prisma.kltPreset.findUnique({ where: { id: presetId }, select: { paths: true } });
  if (!preset) return { success: false, error: 'Preset not found' };

  const paths = Array.isArray(preset.paths) ? (preset.paths as unknown as string[][]) : [];
  const data = await applyPaths(access.setId, paths);
  return { success: true, data };
}

/**
 * Derive this set's own root-to-node paths from its CURRENT `SetKltNode` rows
 * and save them as a new (or replacement) preset. Admin-only — Task 5's
 * "save this set's structure as a preset" control.
 *
 * One path per node (not merely per leaf): `ancestorIds` is root-first and
 * already excludes `self`, so `[...ancestorNames, node.name]` is exactly the
 * root-to-node path for that row. Every node gets its own entry, including
 * interior ones, so a branch with no leaves of its own is still captured
 * rather than silently dropped — `applyPaths` treats a path whose segments
 * all already exist as a no-op, so the redundancy with deeper paths sharing
 * the same prefix costs nothing.
 *
 * `derivePath` REFUSES A NODE WHOLE, rather than shortening its path, when
 * one of its `ancestorIds` has no node in this set (a `parent_not_in_set`
 * invariant violation — the tree is broken, not merely sparse). The
 * codebase rule everywhere else in this feature is "refuse whole, never
 * truncate": a truncated path here would bake a WRONG chain (e.g.
 * `['finance', 'ratios', 'quick ratio']` for a node whose real chain is
 * `finance > accounting > ratios > quick ratio`) into a shared, install-wide
 * preset that every other owner who applies it inherits — worse than a
 * skipped row, which is at least visible. `skipped` reports how many nodes
 * were dropped this way so the admin isn't left thinking the capture was
 * complete when it silently wasn't.
 *
 * Uses `requireSetKltAccess`'s own `viaAllowlist` to decide admin-ness,
 * rather than a second, independent `isCallerKltAdmin()` check — access to
 * THIS set has already been resolved once, from the database; asking a
 * second, unrelated question ("is this caller an operator at all") the same
 * way `renameConcept` does keeps there being exactly one source of truth for
 * "was this access via the allowlist".
 */
export async function savePresetFromSet(
  setId: string,
  name: string,
): Promise<ActionResult<{ id: string; skipped: number }>> {
  const access = await requireSetKltAccess(setId);
  if (!access || !access.viaAllowlist) return NOT_FOUND;

  const rows = await loadSetTree(access.setId);
  const byKltId = new Map(rows.map((r) => [r.kltId, r]));

  const paths: string[][] = [];
  let skipped = 0;
  for (const row of rows) {
    const path = derivePath(row, byKltId);
    if (path === null) {
      skipped++;
      continue;
    }
    paths.push(path);
  }

  const saved = await savePreset(name, paths);
  if (!saved.success) return saved;
  return { success: true, data: { id: saved.data.id, skipped } };
}

/**
 * `node`'s root-to-node path, or `null` when any of `node.ancestorIds` has
 * no node in this set — refused whole rather than shortened. See the
 * `savePresetFromSet` doc comment for why a truncated path is worse than a
 * skipped one.
 */
function derivePath(node: TreeNodeRow, byKltId: Map<string, TreeNodeRow>): string[] | null {
  const ancestorNames: string[] = [];
  for (const id of node.ancestorIds) {
    const ancestor = byKltId.get(id);
    if (!ancestor) return null;
    ancestorNames.push(ancestor.name);
  }
  return [...ancestorNames, node.name];
}
