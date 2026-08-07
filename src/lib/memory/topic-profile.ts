import type { LearnerCardProfile } from '@/lib/memory/profile'
import type { DerivedTag } from '@/lib/errors/derive'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'
import { computeArticulation, type KnowledgeRef } from '@/lib/metrics/articulation'

/**
 * One per-set `CardCategory` row, resolved to the KLPs its cards teach.
 *
 * Topics key on `normalizedName` because categories are SET-SCOPED: the same
 * concept exists as separate rows per set, and grouping on that key is how
 * `/profile/memory` already spans sets without a schema migration. Keying on
 * category id would make "valuation" three different topics across three sets.
 */
export interface TopicRow {
  normalizedName: string
  displayName: string
  color: string | null
  /** LIVE KLP ids. Knowledge and `klpCount` are computed from these alone. */
  klpIds: string[]
  /**
   * Retired KLP ids for the same cards — versions superseded by a card edit.
   *
   * Separate from `klpIds` rather than merged into it because the two are used
   * for different things. Knowledge must stay LIVE-ONLY: a superseded KLP
   * describes an older version of the card and its evidence should not move the
   * current estimate. But TAG ATTRIBUTION must include them, because a
   * historical tag points at whichever version was live when the answer was
   * given. Filtering tags through the live set alone meant editing a card
   * silently emptied readiness's numerator for it while its answers stayed in
   * the denominator — readiness jumped toward 1.0 on an edit.
   */
  supersededKlpIds: string[]
  /**
   * The cards assigned to this category. Needed because a WHOLE-ANSWER tag
   * (`no_thesis`, `disorganized`, `rambling` — the grading prompt tells the
   * model to omit the KLP reference for these) has no klpId to attribute it
   * by. Scoping those tags by KLP alone drops them entirely, so a learner
   * whose every answer rambles scores perfect readiness.
   */
  cardIds: string[]
}

export interface LearnerTopicProfile {
  key: string
  name: string
  color: string | null
  klpCount: number
  /** Mean pKnown across KLPs clearing MIN_OBSERVATIONS. Null when none do. */
  knowledge: number | null
  verbosityIndex: number
  knowledgeGapTerseness: number
  readiness: number | null
}

/** The composite injected into prompts — both grains, one object. */
export interface LearnerProfile {
  cards: LearnerCardProfile
  topics: LearnerTopicProfile[]
}

export interface ShapeTopicProfileInput {
  topics: TopicRow[]
  knowledge: Record<string, KnowledgeRef>
  tags: DerivedTag[]
  /**
   * Analyzed-answer count per topic key. Required because readiness is an
   * intensity (weight per answer), not a lifetime sum — see articulation.ts.
   *
   * It cannot be derived from `tags`: a clean answer produces NO tags, and a
   * clean answer is exactly the positive evidence readiness needs. Counting
   * distinct answers among the tags would only ever see the answers that went
   * wrong, making every learner look maximally unready.
   *
   * Required (not optional/defaulted) so the caller populating this map — the
   * read API — is forced to decide where the count comes from: analyzed-answer
   * rows, not tags. A topic key absent from this map (propositions exist, but
   * no analyzed answers yet) yields `readiness: null`, not 0 — see
   * `computeArticulation`'s `analyzedAnswers === 0` branch.
   */
  analyzedAnswersByTopic: Record<string, number>
}

export function shapeTopicProfile(input: ShapeTopicProfileInput): LearnerTopicProfile[] {
  const grouped = new Map<string, TopicRow[]>()
  for (const t of input.topics) {
    const list = grouped.get(t.normalizedName)
    if (list) list.push(t)
    else grouped.set(t.normalizedName, [t])
  }

  const out: LearnerTopicProfile[] = []
  for (const [key, rows] of grouped) {
    const klpIds = [...new Set(rows.flatMap((r) => r.klpIds))]
    const cardSet = new Set(rows.flatMap((r) => r.cardIds))
    // Live AND superseded: this set is used ONLY to attribute a tag to its
    // topic. `klpIds` stays live-only below, so knowledge and klpCount are
    // unaffected by history.
    const attributableKlpSet = new Set([
      ...klpIds,
      ...rows.flatMap((r) => r.supersededKlpIds),
    ])

    const scored = klpIds
      .map((id) => input.knowledge[id])
      .filter((k): k is KnowledgeRef => k !== undefined && k.observations >= MIN_OBSERVATIONS)

    const knowledge =
      scored.length === 0
        ? null
        : scored.reduce((sum, k) => sum + k.pKnown, 0) / scored.length

    // A KLP-targeted tag belongs to this topic when the KLP does — in ANY
    // version, live or superseded, since the tag names the version that was
    // asked. A whole-answer tag has no KLP, so it belongs when its CARD does —
    // `computeArticulation` then counts it toward expression weight while
    // still keeping it out of the signed index.
    const articulation = computeArticulation({
      tags: input.tags.filter((t) =>
        t.klpId !== null
          ? attributableKlpSet.has(t.klpId)
          : t.cardId !== null && cardSet.has(t.cardId),
      ),
      knowledge: input.knowledge,
      analyzedAnswers: input.analyzedAnswersByTopic[key] ?? 0,
    })

    out.push({
      key,
      // Most common display name wins, matching groupCategoriesByName.
      name: mostCommonName(rows),
      color: rows.find((r) => r.color !== null)?.color ?? null,
      klpCount: klpIds.length,
      knowledge,
      verbosityIndex: articulation.verbosityIndex,
      knowledgeGapTerseness: articulation.knowledgeGapTerseness,
      readiness: articulation.readiness,
    })
  }

  return out
}

function mostCommonName(rows: TopicRow[]): string {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.displayName, (counts.get(r.displayName) ?? 0) + 1)
  let best = rows[0].displayName
  let bestCount = -1
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

export function composeLearnerProfile(
  cards: LearnerCardProfile,
  topics: LearnerTopicProfile[],
): LearnerProfile {
  return { cards, topics }
}

/** A CardCategory row as Prisma returns it, with assignments and KLPs joined. */
export interface RawCategoryRow {
  normalizedName: string
  name: string
  color: string | null
  assignments: { card: { id: string; klps: { id: string; supersededAt: Date | null }[] } }[]
}

/**
 * Flatten joined category rows into TopicRows. Lives here, not in the read
 * shell, so the KLP flattening is covered by tests like every other decision —
 * including the live/superseded split, which is a correctness boundary rather
 * than a formatting detail: put a retired id in `klpIds` and it starts moving
 * the knowledge estimate; leave it out of `supersededKlpIds` and its tags fall
 * out of readiness.
 */
export function toTopicRows(rows: RawCategoryRow[]): TopicRow[] {
  return rows.map((c) => {
    const klps = c.assignments.flatMap((a) => a.card.klps)
    return {
      normalizedName: c.normalizedName,
      displayName: c.name,
      color: c.color,
      klpIds: klps.filter((k) => k.supersededAt === null).map((k) => k.id),
      supersededKlpIds: klps.filter((k) => k.supersededAt !== null).map((k) => k.id),
      cardIds: c.assignments.map((a) => a.card.id),
    }
  })
}
