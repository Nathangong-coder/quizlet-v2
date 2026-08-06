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
  klpIds: string[]
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
   * Optional: callers that don't care about readiness (e.g. tests exercising
   * only knowledge/klpCount) can omit it; missing counts default to 0, same
   * as an explicit miss on a present map.
   */
  analyzedAnswersByTopic?: Record<string, number>
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
    const klpSet = new Set(klpIds)

    const scored = klpIds
      .map((id) => input.knowledge[id])
      .filter((k): k is KnowledgeRef => k !== undefined && k.observations >= MIN_OBSERVATIONS)

    const knowledge =
      scored.length === 0
        ? null
        : scored.reduce((sum, k) => sum + k.pKnown, 0) / scored.length

    const articulation = computeArticulation({
      tags: input.tags.filter((t) => t.klpId !== null && klpSet.has(t.klpId)),
      knowledge: input.knowledge,
      analyzedAnswers: input.analyzedAnswersByTopic?.[key] ?? 0,
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
  assignments: { card: { klps: { id: string }[] } }[]
}

/**
 * Flatten joined category rows into TopicRows. Lives here, not in the read
 * shell, so the KLP flattening is covered by tests like every other decision.
 */
export function toTopicRows(rows: RawCategoryRow[]): TopicRow[] {
  return rows.map((c) => ({
    normalizedName: c.normalizedName,
    displayName: c.name,
    color: c.color,
    klpIds: c.assignments.flatMap((a) => a.card.klps.map((k) => k.id)),
  }))
}
