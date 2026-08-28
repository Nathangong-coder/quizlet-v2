import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'

/**
 * "Recommended" — public sets matching the learner's weak categories.
 *
 * THE WEAKEST THING IN THIS FEATURE, AND KNOWINGLY SO. `CardCategory` is
 * set-scoped and `groupCategoriesByName` collapses rows across sets by
 * `normalizedName`, so this works mechanically with no schema change. But a
 * user-authored category is often a FORMAT or MODALITY — "label the image",
 * "talking", "vocabulary" — not a subject (CLAUDE.md, 2026-08-14). Within one
 * account that is harmless because the learner knows what they meant. Across
 * accounts it is actively wrong: one user's `vocabulary` is Spanish and
 * another's is finance, and `normalizedName` says they are the same topic.
 * This is a string match wearing a concept's clothing.
 *
 * Three mitigations, all mandatory (design §9):
 *   1. ALWAYS state the reason. A wrong match then reads as obviously wrong to
 *      the learner instead of as a mysterious ranking. Cheapest and most
 *      important of the three.
 *   2. Require real evidence on BOTH sides — the learner's own observation
 *      floor on their side, MIN_CARDS_PER_CATEGORY on the target set's.
 *   3. NOTHING HERE WRITES. This is a recommendation surface, not evidence,
 *      and it must never feed the learner model. A source-level test in
 *      tests/sets/visibility-enforcement.test.ts asserts this module contains
 *      no Prisma write.
 */

/**
 * How many cards in the target set must carry the matching category.
 *
 * A one-card coincidence must not surface a whole set. This is the target
 * side of "real evidence on both sides"; the learner side is their own
 * `MetricThresholds.minObservations`, already applied by `shapeTopicProfile`
 * before `knowledge` is non-null at all.
 */
export const MIN_CARDS_PER_CATEGORY = 3

/**
 * Above this, the learner is not weak enough for the category to be worth
 * recommending against. Deliberately generous — the cost of a missed
 * recommendation is nothing, the cost of recommending a topic someone has
 * already mastered is that the whole surface reads as noise.
 */
export const WEAK_CEILING = 0.75

export interface WeakCategory {
  key: string
  name: string
  knowledge: number
}

export interface CandidateSet {
  id: string
  title: string
  ownerHandle: string | null
  cardCount: number
  /** normalizedName -> how many cards in this set carry it. */
  categoryCounts: Record<string, number>
}

export interface Recommendation {
  setId: string
  title: string
  ownerHandle: string | null
  cardCount: number
  /** Rendered VERBATIM and always visible. Never a tooltip. */
  because: string
}

export type RecommendReason =
  | 'no_public_sets'
  | 'no_categorized_cards'
  | 'below_floor'
  | 'no_match'

/**
 * The learner's weak categories, weakest first.
 *
 * A null `knowledge` is DROPPED, never treated as zero. Null means no KLP in
 * that topic cleared the learner's own observation floor — no evidence, which
 * is a different claim from bad evidence. Reading it as 0 would make every
 * untouched topic the learner's single weakest area and drive the entire
 * ranking off topics nobody has measured.
 */
export function pickWeakCategories(topics: LearnerTopicProfile[]): WeakCategory[] {
  return topics
    .filter(
      (t): t is LearnerTopicProfile & { knowledge: number } =>
        t.knowledge !== null && t.knowledge < WEAK_CEILING,
    )
    .map((t) => ({ key: t.key, name: t.name, knowledge: t.knowledge }))
    .sort((a, b) => a.knowledge - b.knowledge)
}

/**
 * Rank candidate sets against the learner's weak categories.
 *
 * Weakest category first, and each set appears AT MOST ONCE — a set carrying
 * three of your weak categories is not three recommendations, and listing it
 * repeatedly would let one set crowd out every other.
 */
export function rankRecommendations(
  weak: WeakCategory[],
  candidates: CandidateSet[],
): Recommendation[] {
  const out: Recommendation[] = []
  const taken = new Set<string>()

  for (const category of weak) {
    for (const set of candidates) {
      if (taken.has(set.id)) continue
      if ((set.categoryCounts[category.key] ?? 0) < MIN_CARDS_PER_CATEGORY) continue
      taken.add(set.id)
      out.push({
        setId: set.id,
        title: set.title,
        ownerHandle: set.ownerHandle,
        cardCount: set.cardCount,
        // The reason is not decoration. Cross-user category matching is a
        // string match wearing a concept's clothing; naming the match is what
        // lets a learner see that a wrong one IS wrong, rather than trusting a
        // ranking they cannot inspect.
        because: `Because you're weak on ${category.name}`,
      })
    }
  }

  return out
}

/**
 * WHY there is nothing to show — four causes, not one.
 *
 * Mirrors `diagnoseEmptyState` (`src/lib/metrics/coverage.ts`). The remedies
 * are completely different — publish something, categorize your cards, study
 * more, or simply no overlap — and merging them produces the "is this broken?"
 * confusion the 3B gate hit twice.
 */
export function diagnoseRecommendEmpty({
  publicSetCount,
  topicCount,
  weakCount,
}: {
  publicSetCount: number
  topicCount: number
  weakCount: number
}): RecommendReason {
  if (publicSetCount === 0) return 'no_public_sets'
  if (topicCount === 0) return 'no_categorized_cards'
  if (weakCount === 0) return 'below_floor'
  return 'no_match'
}

export const RECOMMEND_EMPTY_COPY: Record<RecommendReason, string> = {
  no_public_sets: 'Nobody has published a set yet. When they do, they show up here.',
  no_categorized_cards:
    'Add categories to your cards and this can suggest sets that cover what you find hard.',
  below_floor:
    'Not enough study history yet to tell what you find hard. Take a quiz or two and check back.',
  no_match: 'Nothing published covers what you are weakest on right now.',
}

export interface RecommendResult {
  recommendations: Recommendation[]
  /** Null when there is something to show. */
  emptyReason: RecommendReason | null
}

/**
 * Thin, READ-ONLY DB shell. Untested here by the same convention as
 * `getLearnerMetrics` — every computation it delegates to is covered above.
 *
 * `@/lib/db` is imported DYNAMICALLY so importing this module for its types
 * never touches `lib/db.ts`, which throws at import time without DATABASE_URL.
 */
export async function loadRecommendations(userId: string): Promise<RecommendResult> {
  const { prisma } = await import('@/lib/db')
  const { getLearnerMetrics } = await import('@/lib/metrics/read')
  const { EMPTY_SCOPE } = await import('@/lib/memory/scope')
  const { composeSetWhere, listableSetWhere } = await import('@/lib/sets/visibility')

  // EMPTY_SCOPE is the consolidated cross-set view — recommendations are about
  // the learner as a whole, not about whatever set they last looked at.
  const metrics = await getLearnerMetrics({ userId, scope: EMPTY_SCOPE })
  const weak = pickWeakCategories(metrics.profile.topics)

  const rows = await prisma.set.findMany({
    where: {
      AND: [
        composeSetWhere(userId, listableSetWhere()),
        // Not your own, and not one you have already copied.
        { userId: { not: userId } },
        { forks: { none: { userId } } },
      ],
    },
    take: 60,
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true,
      title: true,
      user: { select: { handle: true } },
      _count: { select: { cards: true } },
      categories: {
        select: {
          normalizedName: true,
          _count: { select: { assignments: true } },
        },
      },
    },
  })

  const candidates: CandidateSet[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    ownerHandle: r.user.handle,
    cardCount: r._count.cards,
    categoryCounts: Object.fromEntries(
      r.categories.map((c) => [c.normalizedName, c._count.assignments]),
    ),
  }))

  const recommendations = rankRecommendations(weak, candidates)

  return {
    recommendations,
    emptyReason:
      recommendations.length > 0
        ? null
        : diagnoseRecommendEmpty({
            publicSetCount: candidates.length,
            topicCount: metrics.profile.topics.length,
            weakCount: weak.length,
          }),
  }
}
