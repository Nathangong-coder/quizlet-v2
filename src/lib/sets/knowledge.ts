import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'
import { shadeForKnowledge, type MasteryShade } from '@/lib/klt/mastery-shade'

/**
 * What the Knowledge tab renders, for ONE set and ONE viewer.
 *
 * Everything here comes from data that already exists — `CardProgress`,
 * `StudyEvent`, `StudySession`, `KlpState`, `SetKltNode`, `CardCategory`. This
 * module adds no writes and the feature adds no columns, deliberately: a view
 * that needs new writes before it says anything cannot be judged until those
 * writes have accumulated, which is months.
 */

/**
 * One row of the mastery list.
 *
 * DELIBERATELY KNOWS NOTHING ABOUT `SetKltNode`. The list view has to outlive
 * the concept tree: the roadmap intends KLP-inherent topics living beside user
 * categories (CLAUDE.md, 2026-08-14), and when that lands it will produce rows
 * of exactly this shape from a different source. A row typed against the KLT
 * tree would have to be rewritten; this one renders unchanged.
 *
 * `key` is a `normalizedName`, not an id, for the same reason: a concept is
 * identified across sets by its name, and `CardCategory` rows are set-scoped.
 */
export interface TopicMasteryRow {
  key: string
  name: string
  /** Tree depth, or null for a user-authored category, which has no position. */
  depth: number | null
  /** Null means NO EVIDENCE. Never coerce it to 0 — see `shadeForKnowledge`. */
  knowledge: number | null
  klpCount: number
  shade: MasteryShade
}

/**
 * Order: measured-and-weakest first, then everything unmeasured.
 *
 * Unmeasured concepts go LAST rather than first-as-zero. Sorting them to the
 * top (which `knowledge ?? 0` does for free) fills the entire first screen with
 * concepts nobody has been tested on, burying the ones the learner is actually
 * failing — the list would be sorted by "what we haven't looked at" while
 * claiming to be sorted by weakness.
 */
export function shapeTopicMastery(topics: LearnerTopicProfile[]): TopicMasteryRow[] {
  return topics
    .map((t) => ({
      key: t.key,
      name: t.name,
      depth: t.depth,
      knowledge: t.knowledge,
      klpCount: t.klpCount,
      shade: shadeForKnowledge(t.knowledge),
    }))
    .sort((a, b) => {
      if (a.knowledge === null && b.knowledge === null) return a.name.localeCompare(b.name)
      if (a.knowledge === null) return 1
      if (b.knowledge === null) return -1
      return a.knowledge - b.knowledge
    })
}

/** Shades keyed by concept name, for the canvas. */
export function shadesByKey(rows: TopicMasteryRow[]): Record<string, MasteryShade> {
  return Object.fromEntries(rows.map((r) => [r.key, r.shade]))
}

export interface ConfidenceHistogram {
  /** Ten buckets, index 0 = confidence 1. */
  buckets: number[]
  studied: number
  /** Cards due for review now, including those never scheduled. */
  due: number
  /** Mean over studied cards, or null when none are — never 0. */
  average: number | null
}

export interface ConfidenceRow {
  confidence: number
  dueAt: Date | null
}

/**
 * Confidence across this set.
 *
 * A NULL `dueAt` COUNTS AS DUE, matching `getDueCards`
 * (`src/lib/memory/schedule.ts`) and `shapeSetSummaries`. Null means never
 * scheduled — a starred-but-unstudied card, or a row predating the scheduler —
 * which is a reason to review it, not to hide it. Treating null as "not due"
 * here would make this page report fewer due cards than Review mode then
 * offers, and a learner cannot tell which surface is lying.
 *
 * `average` is null for an unstudied set rather than 0, the same rule
 * `SetStudySummary.averageConfidence` follows: zero reads as "you know none of
 * this" on a set nobody has opened.
 */
export function shapeConfidenceHistogram(rows: ConfidenceRow[], now: Date): ConfidenceHistogram {
  const buckets = new Array(10).fill(0)
  let total = 0
  let due = 0

  for (const row of rows) {
    // Clamped rather than trusted: a confidence outside 1-10 would write past
    // the end of the array and render as a silently missing bar.
    const index = Math.min(9, Math.max(0, Math.round(row.confidence) - 1))
    buckets[index] += 1
    total += row.confidence
    if (row.dueAt === null || row.dueAt.getTime() <= now.getTime()) due += 1
  }

  return {
    buckets,
    studied: rows.length,
    due,
    average: rows.length > 0 ? total / rows.length : null,
  }
}

export interface SetKnowledge {
  topics: TopicMasteryRow[]
  categories: CategoryMasteryRow[]
  confidence: ConfidenceHistogram
  sessions: { id: string; kind: string; startedAt: Date; durationMs: number | null; itemCount: number }[]
  conceptCount: number
}

/** How many sessions the per-set history shows before linking out. */
export const SET_HISTORY_LIMIT = 8

/**
 * Thin, READ-ONLY DB shell. Untested here by the same convention as
 * `getLearnerMetrics` and `loadRecommendations` — every computation it
 * delegates to is covered above.
 *
 * NO SET READ HERE, deliberately. The caller has already resolved the set
 * through `readableSetWhere` and passes an id it has proven this viewer may
 * read; adding a second, unguarded lookup would be the exact shape
 * `ENFORCED_PATHS` exists to catch. Everything below is keyed on `userId` as
 * well, so nothing crosses accounts even if that contract were broken.
 *
 * `@/lib/db` is imported DYNAMICALLY so importing this module for its types
 * never touches `lib/db.ts`, which throws at import time without DATABASE_URL.
 */
export async function loadSetKnowledge(userId: string, setId: string): Promise<SetKnowledge> {
  const { prisma } = await import('@/lib/db')
  const { getLearnerMetrics } = await import('@/lib/metrics/read')

  const scope = { setIds: [setId], categoryKeys: [], sources: [] }

  const [metrics, categoryRows, progressRows, sessions, uncategorized] = await Promise.all([
    // ONE set's scope. The same object drives Analysis, so the two tabs cannot
    // disagree about which answers they are describing.
    getLearnerMetrics({ userId, scope }),
    prisma.cardCategory.findMany({
      where: { setId },
      select: {
        normalizedName: true,
        name: true,
        color: true,
        _count: { select: { assignments: true } },
      },
    }),
    prisma.cardProgress.findMany({
      where: { userId, card: { setId } },
      select: { confidence: true, dueAt: true },
    }),
    prisma.studySession.findMany({
      where: { userId, setId },
      orderBy: { startedAt: 'desc' },
      take: SET_HISTORY_LIMIT,
      select: { id: true, kind: true, startedAt: true, durationMs: true, itemCount: true },
    }),
    // Cards in NO category. `none` rather than counting assignments and
    // subtracting: a card in two categories would be double-counted by the
    // subtraction and could make the uncategorized figure negative.
    prisma.card.count({ where: { setId, categoryAssignments: { none: {} } } }),
  ])

  const topics = shapeTopicMastery(metrics.profile.topics)

  return {
    topics,
    categories: shapeCategoryMastery(
      categoryRows.map((c) => ({
        normalizedName: c.normalizedName,
        name: c.name,
        color: c.color,
        cardCount: c._count.assignments,
      })),
      metrics.profile.topics,
      uncategorized,
    ),
    confidence: shapeConfidenceHistogram(progressRows, new Date()),
    sessions,
    conceptCount: topics.length,
  }
}

/**
 * Analysis's data, with a NAMED reason when there is nothing to show.
 *
 * Reuses `diagnoseEmptyState` rather than hand-rolling a "no data yet" branch.
 * That function already separates five causes whose remedies are completely
 * different — no key points, nothing in scope, no history, below your evidence
 * floor, nothing categorized — and its own doc records that the 3B live gate
 * produced two of them and both read as a broken feature until diagnosed
 * against the database. One merged message sends half of them to the wrong fix.
 */
export async function loadSetAnalysis(userId: string, setId: string) {
  const { prisma } = await import('@/lib/db')
  const { getLearnerMetrics, resolveScopeCategoryIds } = await import('@/lib/metrics/read')
  const { loadCoverage, diagnoseEmptyState } = await import('@/lib/metrics/coverage')
  const { getUserTuning } = await import('@/lib/tuning/store')

  const scope = { setIds: [setId], categoryKeys: [], sources: [] }
  const tuning = await getUserTuning(userId)
  const floor = tuning.thresholds.minObservations
  const categoryIds = await resolveScopeCategoryIds(prisma, userId, scope.categoryKeys)

  const [metrics, coverage] = await Promise.all([
    getLearnerMetrics({ userId, scope }),
    loadCoverage(prisma, userId, scope, categoryIds, floor),
  ])

  // `scoped: true` always — this view IS one set. That makes
  // `scope_too_narrow` reachable, and it is the correct diagnosis here: the
  // library has material this page cannot report on because you are looking at
  // one set. Its usual REMEDY ("widen your saved scope") is wrong in this
  // context though, which is why the copy is set-specific rather than reusing
  // `EmptyDashboard` verbatim.
  return { metrics, empty: diagnoseEmptyState(coverage, true, floor), floor }
}

export interface CategoryMasteryRow {
  key: string
  name: string
  color: string | null
  cardCount: number
  knowledge: number | null
  shade: MasteryShade
}

/**
 * Join this set's categories to whatever the topic profile measured for them.
 *
 * The profile keys topics on `normalizedName`; categories are set-scoped rows.
 * A category the profile has nothing for keeps `knowledge: null` and shades as
 * `unknown` — it is not absent from the list, because "you have a category with
 * no evidence yet" is exactly the thing this view should be able to say.
 */
export function shapeCategoryMastery(
  categories: { normalizedName: string; name: string; color: string | null; cardCount: number }[],
  topics: LearnerTopicProfile[],
  /**
   * Cards in NO category. Renders as an explicit bucket rather than being
   * omitted — the same OR-plus-uncategorized semantics `filterCardsByCategories`
   * already applies in every study mode, so the two surfaces agree about what
   * "uncategorized" means.
   *
   * It matters because it is the only thing on the page that can say "a third
   * of this set is not in any topic". Silence there is indistinguishable from
   * full coverage, and a learner reading category mastery would believe they
   * had measured the whole set.
   */
  uncategorizedCount = 0,
): CategoryMasteryRow[] {
  const byKey = new Map(topics.map((t) => [t.key, t]))
  const rows = categories
    .map((c) => {
      const knowledge = byKey.get(c.normalizedName)?.knowledge ?? null
      return {
        key: c.normalizedName,
        name: c.name,
        color: c.color,
        cardCount: c.cardCount,
        knowledge,
        shade: shadeForKnowledge(knowledge),
      }
    })
    .sort((a, b) => b.cardCount - a.cardCount || a.name.localeCompare(b.name))

  if (uncategorizedCount > 0) {
    // ALWAYS LAST, whatever its size, and never sorted among the real ones. It
    // is not a category the learner made; it is the absence of one, and letting
    // it head the list because it is the biggest bucket would present "no
    // topic" as this set's main topic.
    //
    // `knowledge: null` is honest rather than lazy: these cards have no concept
    // to roll up to, so nothing has ever measured them AS a group. Spec 3C's
    // ruling stands — uncategorized KLPs participate in targeting but not in
    // topic mastery.
    rows.push({
      key: UNCATEGORIZED_KEY,
      name: 'Uncategorized',
      color: null,
      cardCount: uncategorizedCount,
      knowledge: null,
      shade: shadeForKnowledge(null),
    })
  }

  return rows
}

/** Reserved key for the no-category bucket. Not a `normalizedName`. */
export const UNCATEGORIZED_KEY = '__uncategorized__'
