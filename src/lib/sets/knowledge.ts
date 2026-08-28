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

  const [metrics, categoryRows, progressRows, sessions] = await Promise.all([
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
    ),
    confidence: shapeConfidenceHistogram(progressRows, new Date()),
    sessions,
    conceptCount: topics.length,
  }
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
): CategoryMasteryRow[] {
  const byKey = new Map(topics.map((t) => [t.key, t]))
  return categories
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
}
