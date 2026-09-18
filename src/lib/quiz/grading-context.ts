import { prisma } from '@/lib/db';
import type { PromptRelation, PromptFormReq } from '@/lib/ai/prompts/grade-short-answer';

/**
 * What the short-answer grader is shown BESIDE the live key points (Spec 5,
 * "The boundary"): the card's relations, its form requirements and its
 * reference answer. Nothing about the learner — that is the whole point of
 * the boundary, and why this module has no `userId` parameter at all.
 *
 * Deliberately NOT a `'use server'` export. `ensureKlpsReady` (the caller's
 * source of `klps`) is readable-scoped and is the only gate this needs: a
 * relation, form requirement or reference is derived from KLPs the caller
 * was already allowed to read, so a plain helper taking those KLPs adds no
 * endpoint and no second visibility check that could drift from the first.
 */
export interface GradingContext {
  /** `KlpRelation` edges whose BOTH endpoints are live key points, in stable order. */
  relations: { id: string; type: string; fromKlpId: string; toKlpId: string }[];
  /** `CardFormRequirement` rows at the live `klpVersion`, one per `index`. */
  formReqs: { id: string; index: number; text: string }[];
  /** `CardAuthoring.referenceAnswer` for the live version, or null when never authored. */
  referenceAnswer: string | null;
}

const EMPTY: GradingContext = { relations: [], formReqs: [], referenceAnswer: null };

/**
 * Loads the grading context for one card from its live key points.
 *
 * `klps` are the rows `ensureKlpsReady` returned: live (`supersededAt: null`),
 * so their `version` IS the card's current `klpVersion` (`writeKlpVersion`
 * stamps both in one transaction). Reading the version off the KLPs rather
 * than off a `Card` row loaded earlier means a card whose extraction landed
 * between that load and this call still gets the form requirements and
 * reference of the version the grader is actually shown.
 *
 * No live key points means no relations, no form requirements (authored per
 * `klpVersion`, after KLPs) and no reference (written by the authoring that
 * produced the KLPs) — so the empty context is returned without a query.
 */
export async function loadGradingContext(
  cardId: string,
  klps: { id: string; version: number }[],
): Promise<GradingContext> {
  if (klps.length === 0) return EMPTY;
  const klpVersion = klps[0].version;
  const ids = klps.map((k) => k.id);
  const live = new Set(ids);

  const [relationRows, formRows, authoring] = await Promise.all([
    prisma.klpRelation.findMany({
      where: { fromKlpId: { in: ids }, toKlpId: { in: ids } },
      // Stable order: the prompt ref IS the array position, and the writer
      // resolves the grader's `relationRef` back through the same array.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, fromKlpId: true, toKlpId: true },
    }),
    prisma.cardFormRequirement.findMany({
      where: { cardId, klpVersion },
      orderBy: [{ index: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, index: true, text: true },
    }),
    prisma.cardAuthoring.findFirst({
      where: { cardId, klpVersion },
      // Latest first in case a version was authored twice (a re-run after a
      // failure) — the same rule `authorFormRequirements` reads by.
      orderBy: { createdAt: 'desc' },
      select: { referenceAnswer: true },
    }),
  ]);

  // Both endpoints live, guaranteed here and not only by the query: the
  // prompt renders a relation by its endpoints' REFS, and a dangling endpoint
  // would have no ref to render.
  const relations = relationRows.filter((r) => live.has(r.fromKlpId) && live.has(r.toKlpId));

  // One requirement per index, first row winning. There is no unique index
  // on (cardId, klpVersion, index) until Task 9's migration, so an owner
  // click racing the cron can double-write a card; the grader must see each
  // shape once or two refs would name the same requirement.
  const seen = new Set<number>();
  const formReqs = formRows.filter((f) => {
    if (seen.has(f.index)) return false;
    seen.add(f.index);
    return true;
  });

  return { relations, formReqs, referenceAnswer: authoring?.referenceAnswer ?? null };
}

/**
 * The prompt's view of the context: refs, never ids.
 *
 * A ref is the array position in the context the caller will ALSO hand to
 * `buildAnalysisWrites` as `relations` / `formReqs`, which resolves the
 * grader's `relationRef` / `formRef` by that same position. Producing both
 * views from one array is what keeps them aligned — a verdict on `[R1]`
 * lands on `relations[1]`, always.
 *
 * Pure. The endpoint refs are looked up in `klps` order, which is the order
 * the prompt lists the key points in.
 */
export function promptViewOf(
  klps: { id: string }[],
  ctx: GradingContext,
): { promptRelations: PromptRelation[]; promptFormReqs: PromptFormReq[] } {
  const refOf = new Map(klps.map((k, ref) => [k.id, ref]));
  return {
    promptRelations: ctx.relations.map((r, ref) => ({
      ref,
      type: r.type,
      // Both endpoints are live by `loadGradingContext`'s contract; `-1`
      // would only ever render if a caller bypassed it.
      fromRef: refOf.get(r.fromKlpId) ?? -1,
      toRef: refOf.get(r.toKlpId) ?? -1,
    })),
    promptFormReqs: ctx.formReqs.map((f, ref) => ({ ref, text: f.text })),
  };
}
