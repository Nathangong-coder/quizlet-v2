import { z } from 'zod'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'
import { EMPTY_SCOPE, type HistoryScope } from '@/lib/memory/scope'

/**
 * Spec 3C §6. The learner's saved answer to "what am I working on right now?",
 * stored as a fourth sparse blob on `LearnerTuning`.
 *
 * Sets by id, categories by `normalizedName` — see the Prisma comment on
 * `LearnerTuning.studyScope` for why the asymmetry is deliberate.
 */
export const StudyScopeSchema = z
  .object({
    setIds: z.array(z.string()).default([]),
    categoryKeys: z.array(z.string()).default([]),
  })
  .strict()

/**
 * A TYPE ALIAS, not an interface, and that is load-bearing rather than style:
 * TypeScript infers an implicit index signature for object type aliases but
 * never for interfaces, and Prisma's `InputJsonValue` requires one. As an
 * interface this cannot be assigned to the `studyScope` Json column without a
 * cast — and a cast here would defeat the point of validating the blob.
 * `BandOverrides` and `ThresholdOverrides` are both aliases for the same reason.
 */
export type StoredStudyScope = {
  setIds: string[]
  categoryKeys: string[]
}

export const EMPTY_STUDY_SCOPE: StoredStudyScope = { setIds: [], categoryKeys: [] }

/**
 * Parse a STORED blob. A corrupt one yields an empty scope rather than
 * throwing, matching the other three tuning blobs and `SESSION_INSIGHT_VERSION`
 * — a bad settings row must not make the app unusable. A corrupt SAVE is a
 * different case and is rejected loudly in `saveTuning`.
 *
 * Degrading to empty is safe here in a way it would not be for a filter:
 * empty means "everything", so a corrupt scope shows the learner more than they
 * asked for, never less. The failure is visible rather than silent.
 */
export function parseStudyScope(raw: unknown): StoredStudyScope {
  // Fresh arrays, NOT `{ ...EMPTY_STUDY_SCOPE }` — a spread copies the array
  // REFERENCES, so one caller pushing onto its result would corrupt the shared
  // module-level constant for every future caller. Same rule `resolveBands`
  // follows against DEFAULT_BANDS.
  if (raw === null || raw === undefined) return { setIds: [], categoryKeys: [] }
  const parsed = StudyScopeSchema.safeParse(raw)
  if (!parsed.success) return { setIds: [], categoryKeys: [] }
  return { setIds: parsed.data.setIds, categoryKeys: parsed.data.categoryKeys }
}

export interface ResolvedStudyScope {
  /** The scope to actually apply, containing only references that still exist. */
  scope: HistoryScope
  /** Stored references that no longer resolve, so the panel can offer a cleanup. */
  staleSetIds: string[]
  staleCategoryKeys: string[]
  /**
   * TRUE only when a NON-EMPTY stored scope resolved to nothing and was dropped
   * back to "everything".
   *
   * The emptiness of the stored scope is load-bearing: a learner who never saved
   * one has not been "widened", and firing the notice for them would tell every
   * new user that a setting they never touched has broken.
   */
  widened: boolean
}

/**
 * Resolve a saved scope against what currently exists.
 *
 * Sets get deleted and Stage 3.6 lets categories be renamed, merged and
 * deleted, so a saved scope WILL accumulate dead references in ordinary use —
 * this is not an edge case to guard, it is the steady state to design for.
 *
 * The rule, and the direction is the arguable half:
 * - some references survive -> scope by the survivors;
 * - none survive -> fall back to unscoped, and the caller MUST say so.
 *
 * Widening rather than narrowing, because an empty recommendation list is
 * indistinguishable from a broken feature — the Spec 3B live gate produced
 * exactly that confusion twice — whereas a wider-than-intended list is visible,
 * obviously wrong to the learner, and one click from being fixed. Widening is
 * recoverable and self-announcing; silence is neither.
 *
 * Pure, so every combination is tested without a database.
 */
export function resolveStudyScope(
  stored: StoredStudyScope,
  available: { setIds: string[]; categoryKeys: string[] },
): ResolvedStudyScope {
  const availableSets = new Set(available.setIds)
  const availableCategories = new Set(available.categoryKeys)

  const setIds = stored.setIds.filter((id) => availableSets.has(id))
  const staleSetIds = stored.setIds.filter((id) => !availableSets.has(id))

  // UNCATEGORIZED_ID is a SENTINEL, not a CardCategory row, so it never appears
  // in `available` and would be judged stale by a naive membership test — which
  // would silently drop the one bucket a learner with no categories can pick.
  const survives = (key: string) => key === UNCATEGORIZED_ID || availableCategories.has(key)
  const categoryKeys = stored.categoryKeys.filter(survives)
  const staleCategoryKeys = stored.categoryKeys.filter((key) => !survives(key))

  const storedAnything = stored.setIds.length > 0 || stored.categoryKeys.length > 0
  const survivedAnything = setIds.length > 0 || categoryKeys.length > 0

  return {
    scope: { ...EMPTY_SCOPE, setIds, categoryKeys },
    staleSetIds,
    staleCategoryKeys,
    widened: storedAnything && !survivedAnything,
  }
}
