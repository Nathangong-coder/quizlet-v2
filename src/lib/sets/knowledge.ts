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
  /** How many of `klpCount` cleared the observation floor. See `shade`. */
  measuredKlpCount: number
  /**
   * The shade to PAINT — which is not always `shadeForKnowledge(knowledge)`.
   * See `shapeTopicMastery` for the coverage rule and why it lives here.
   */
  shade: MasteryShade
}

/**
 * The share of a concept's key points that must have been measured before it
 * is painted with a mastery colour at all.
 *
 * WHY A FRACTION AND NOT JUST `knowledge !== null`. `knowledge` is a mean over
 * the KLPs that cleared the observation floor, and a mean is silent about how
 * many that was. On a concept-tree node the effect compounds: `rollUpKltLinks`
 * gives an interior node every descendant's KLPs, so a subject root can hold
 * forty key points, have three of them answered, and report the mean of those
 * three as the whole subject's mastery. It then shades `strong` — a subject the
 * learner has barely been asked about, painted as known. That is the reported
 * bug, and the honest answer for it is "not measured yet", not a colour.
 *
 * A THIRD, deliberately low. This is a floor on whether we may make a CLAIM,
 * not a target: set near 1.0 and a large tree would stay grey forever, which
 * teaches the learner to ignore the shading — the same failure mode
 * `shadeForKnowledge`'s doc comment describes for the opposite error of
 * painting everything red.
 */
export const MIN_MEASURED_FRACTION = 1 / 3

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
      // The NUMBER is reported unchanged, even when the shade is withheld. It
      // is a true statement about what was measured, and a learner who opens
      // the list is entitled to see it next to the coverage that produced it.
      // Only the COLOUR — the thing scanned at a glance, with no denominator
      // beside it — is held back.
      knowledge: t.knowledge,
      klpCount: t.klpCount,
      measuredKlpCount: t.measuredKlpCount,
      shade: shadeForCoverage(t.knowledge, t.measuredKlpCount, t.klpCount),
    }))
    .sort((a, b) => {
      if (a.knowledge === null && b.knowledge === null) return a.name.localeCompare(b.name)
      if (a.knowledge === null) return 1
      if (b.knowledge === null) return -1
      return a.knowledge - b.knowledge
    })
}

/**
 * `shadeForKnowledge`, plus the coverage floor.
 *
 * Kept OUT of `shadeForKnowledge` itself on purpose. That function answers
 * "what does this number mean?" and is used wherever a bare knowledge value has
 * to become a colour, including places that have no KLP counts to offer. This
 * one answers "may we say anything at all yet?", which needs the denominator.
 * Folding the second question into the first would have forced every caller to
 * supply counts it does not have, and two of them would have passed zeros.
 *
 * `klpCount === 0` yields `unknown` without dividing — a concept with no key
 * points has nothing to have measured, and 0/0 is NaN, which
 * `shadeForKnowledge` would swallow into `unknown` by accident rather than by
 * decision.
 */
export function shadeForCoverage(
  knowledge: number | null,
  measuredKlpCount: number,
  klpCount: number,
): MasteryShade {
  if (knowledge === null) return 'unknown'
  if (klpCount === 0) return 'unknown'
  if (measuredKlpCount / klpCount < MIN_MEASURED_FRACTION) return 'unknown'
  return shadeForKnowledge(knowledge)
}

/**
 * Which rung of the concept tree the Knowledge list shows.
 *
 * A tree is drawn all at once on the MAP; a list has to pick a level, and the
 * two useful constraints are "deep enough to be about something" and "short
 * enough to read". `PREFERRED_LIST_DEPTH` is the third rung (depth 2, counting
 * the root as the first) — deep enough that the names are real subjects rather
 * than the one-or-two headline nodes at the top of a tree. `MAX_CONCEPTS_LISTED`
 * is the cap that actually decides: a rung wider than that is a wall of rows,
 * so the search walks UPWARD until a layer fits.
 *
 * Upward, never downward: a shallower rung is a rollup of the one below it, so
 * every concept is still represented, just at a coarser grain. Walking deeper
 * to find a small layer would show a handful of leaves and silently omit whole
 * branches that have no node at that depth.
 *
 * The final fallback is the SHALLOWEST populated rung even when it too exceeds
 * the cap — a tree with nine roots and nothing else has no smaller layer to
 * offer, and a long list beats an empty one.
 */
export const PREFERRED_LIST_DEPTH = 2
export const MAX_CONCEPTS_LISTED = 5

export function selectConceptListDepth(countsByDepth: Map<number, number>): number | null {
  const depths = [...countsByDepth.keys()].filter((d) => (countsByDepth.get(d) ?? 0) > 0)
  if (depths.length === 0) return null
  depths.sort((a, b) => a - b)

  const candidates = depths.filter((d) => d <= PREFERRED_LIST_DEPTH).reverse()
  for (const d of candidates) {
    if ((countsByDepth.get(d) ?? 0) <= MAX_CONCEPTS_LISTED) return d
  }
  return depths[0]
}

/**
 * Reduce the KLT axis to the one rung the list shows.
 *
 * Takes EVERY depth and does the counting itself, so the depth rule and the
 * rows it produces cannot disagree — an earlier shape where the caller counted
 * and this function filtered is exactly how a "max 5" cap ends up rendering
 * seven rows.
 */
export function selectConceptRows(topics: LearnerTopicProfile[]): TopicMasteryRow[] {
  const counts = new Map<number, number>()
  for (const t of topics) {
    if (t.depth === null) continue
    counts.set(t.depth, (counts.get(t.depth) ?? 0) + 1)
  }
  const depth = selectConceptListDepth(counts)
  if (depth === null) return []
  return shapeTopicMastery(topics.filter((t) => t.depth === depth))
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
  /**
   * The CONCEPT axis — `Klt` nodes from this set's concept tree, at the one
   * rung `selectConceptListDepth` picked. What the list renders.
   *
   * This used to be the user-authored CATEGORY axis, which is why the list and
   * the map disagreed about what a "concept" was: the map draws `Klt` nodes,
   * the list named categories, and the shade table joining them keyed on a
   * name. A learner's category called "valuation" then coloured a tree node
   * called "valuation" that shares neither its cards nor its key points.
   */
  topics: TopicMasteryRow[]
  /**
   * Shades for the MAP: the same concept axis at EVERY depth, keyed by
   * normalizedName. Not derived from `topics` — that is one rung, and the map
   * draws the whole tree.
   */
  conceptShades: Record<string, MasteryShade>
  categories: CategoryMasteryRow[]
  confidence: ConfidenceHistogram
  sessions: { id: string; kind: string; startedAt: Date; durationMs: number | null; itemCount: number }[]
  conceptCount: number
  /**
   * Concepts with a real measurement, over the WHOLE axis.
   *
   * Counted here rather than by the page over `topics`, because `topics` is one
   * rung: a page counting there would report "2 concepts measured" on a set
   * where forty are, purely because the list chose a narrow level.
   */
  measuredConceptCount: number
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

  // `kltTopicsAll`, not `kltTopics`: the latter is already narrowed to the
  // dashboard's chosen depth, and the map needs every node it can shade.
  const topics = selectConceptRows(metrics.kltTopicsAll)

  return {
    topics,
    conceptShades: shadesByKey(shapeTopicMastery(metrics.kltTopicsAll)),
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
    // EVERY concept with key points, not just the listed rung — this number
    // heads the page as "N concepts", and reporting the rung's size would say
    // a set had five concepts while its map drew forty.
    conceptCount: metrics.kltTopicsAll.length,
    measuredConceptCount: metrics.kltTopicsAll.filter((t) => t.knowledge !== null).length,
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
  /** How many of this category's key points cleared the observation floor. */
  measuredKlpCount: number
  klpCount: number
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
      const measured = byKey.get(c.normalizedName)
      const knowledge = measured?.knowledge ?? null
      const measuredKlpCount = measured?.measuredKlpCount ?? 0
      const klpCount = measured?.klpCount ?? 0
      return {
        key: c.normalizedName,
        name: c.name,
        color: c.color,
        cardCount: c.cardCount,
        knowledge,
        measuredKlpCount,
        klpCount,
        // The SAME coverage rule the concept axis uses. A category whose mean
        // rests on two of its thirty key points must not read as mastered
        // here and "not measured yet" three inches above it, on one page,
        // about overlapping material.
        shade: shadeForCoverage(knowledge, measuredKlpCount, klpCount),
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
      measuredKlpCount: 0,
      klpCount: 0,
      shade: shadeForKnowledge(null),
    })
  }

  return rows
}

/** Reserved key for the no-category bucket. Not a `normalizedName`. */
export const UNCATEGORIZED_KEY = '__uncategorized__'
