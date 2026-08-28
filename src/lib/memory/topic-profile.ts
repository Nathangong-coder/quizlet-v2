import type { LearnerCardProfile } from '@/lib/memory/profile'
import type { DerivedTag } from '@/lib/errors/derive'
import { DEFAULT_THRESHOLDS, type MetricThresholds } from '@/lib/tuning/schema'
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
  /**
   * Tree depth (0 at a subject root), KLT axis only.
   *
   * OPTIONAL — controller ruling R2 (2026-08-25): `TopicRow` is SHARED with
   * `toTopicRows`, which flattens user-authored CATEGORY rows. Categories have
   * no tree and no depth; a required field here would force every category
   * fixture to invent one to satisfy the type checker.
   */
  depth?: number
}

export interface LearnerTopicProfile {
  key: string
  name: string
  color: string | null
  /**
   * Tree depth (0 at a subject root), KLT axis only. `null` for a
   * user-authored category — see `TopicRow.depth` (controller ruling R2,
   * 2026-08-25): a category has no tree position to report.
   */
  depth: number | null
  klpCount: number
  /**
   * How many of those `klpCount` key points actually cleared the observation
   * floor — the denominator `knowledge` was averaged over.
   *
   * EXISTS BECAUSE A MEAN HIDES ITS OWN COVERAGE. `knowledge` is the mean
   * pKnown over measured KLPs, which is a true statement about the KLPs that
   * were measured and says nothing about the ones that were not. A concept
   * with 40 key points, three of them answered well, reports the same 0.9 as
   * a concept with three key points all answered well — and on the map they
   * shade identically. That was the reported bug: concepts the learner knows
   * they have never been asked about, painted as known.
   *
   * Callers that PRESENT a shade are expected to weigh this (see
   * `shapeTopicMastery`). `knowledge` itself is deliberately unchanged — the
   * prompts and the learner dashboard have always read it as "over what was
   * measured", and redefining it here would silently move numbers on four
   * other surfaces to fix one.
   */
  measuredKlpCount: number
  /**
   * Mean pKnown across KLPs clearing the learner's observation floor
   * (`MetricThresholds.minObservations`). Null when none do.
   */
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
  /**
   * The learner's tuned thresholds, forwarded to `computeArticulation` AND
   * applied to the knowledge filter below. Both, or the floor means one thing
   * for topic knowledge and another for terseness classification — on the same
   * screen, about the same topic.
   */
  thresholds?: MetricThresholds
}

export function shapeTopicProfile(input: ShapeTopicProfileInput): LearnerTopicProfile[] {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS
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
      .filter(
        (k): k is KnowledgeRef =>
          k !== undefined && k.observations >= thresholds.minObservations,
      )

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
      thresholds,
    })

    out.push({
      key,
      // Most common display name wins, matching groupCategoriesByName.
      name: mostCommonName(rows),
      color: rows.find((r) => r.color !== null)?.color ?? null,
      // KLT rows carry depth; category rows never do (`TopicRow.depth` is
      // optional for exactly that reason) — `null` says "no tree position",
      // not "root".
      depth: rows.find((r) => r.depth !== undefined)?.depth ?? null,
      klpCount: klpIds.length,
      measuredKlpCount: scored.length,
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
  /**
   * Only what `toTopicRows` itself reads. The read shell selects more per KLP
   * (`weight`, `cardId`, for Spec 3B's ranking candidates) and passes those
   * rows straight in — structurally compatible, and deliberately NOT declared
   * here: requiring fields this function ignores would make every fixture
   * carry them to satisfy the type checker rather than to express anything.
   */
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

/**
 * A `Klt` row, with its links and their KLPs joined.
 *
 * `links` arrives ALREADY INCLUDING descendants' links — the rollup is done
 * by the read shell (`src/lib/metrics/klt-rollup.ts`), over `ancestorIds`, not
 * here, so this function stays a pure shaper. A node's own links alone would
 * report nothing for every interior node, since key points only ever attach
 * to leaves — `accounting` holds none of its own; every one sits on a leaf
 * far beneath it.
 */
export interface RawKltRow {
  normalizedName: string
  name: string
  /** 0 at a subject root. Passed through so the UI can group by level. */
  depth: number
  links: { rank: number; klp: { id: string; supersededAt: Date | null; cardId: string } }[]
}

/**
 * Flatten KLT rows into the SAME `TopicRow` shape category rows produce, so
 * `shapeTopicProfile` computes knowledge, readiness and verbosity for both
 * axes with one implementation. A KLT topic and a category topic differ in
 * where they came from, not in how they are scored — and two implementations
 * would drift into disagreeing about what "weak" means on one screen.
 *
 * `maxRank` is `MetricThresholds.masteryTopicRanks`. Links above it are
 * excluded from MASTERY only; callers wanting the full associative graph
 * (browse, "related topics") query `KlpTopic` directly rather than here.
 *
 * The live/superseded split is load-bearing and mirrors `toTopicRows`: live
 * KLPs drive knowledge, superseded ones still attribute historical error tags.
 * A topic whose links are ALL superseded is dropped rather than emitted with
 * an empty numerator — it describes a card version nobody studies any more.
 */
export function kltRowsToTopicRows(rows: RawKltRow[], maxRank: number): TopicRow[] {
  const out: TopicRow[] = []
  for (const row of rows) {
    const inRank = row.links.filter((l) => l.rank <= maxRank)
    const klpIds = [
      ...new Set(inRank.filter((l) => l.klp.supersededAt === null).map((l) => l.klp.id)),
    ]
    if (klpIds.length === 0) continue
    out.push({
      normalizedName: row.normalizedName,
      displayName: row.name,
      // KLTs are AI-derived; only user-authored categories carry a colour.
      color: null,
      depth: row.depth,
      klpIds,
      supersededKlpIds: [
        ...new Set(inRank.filter((l) => l.klp.supersededAt !== null).map((l) => l.klp.id)),
      ],
      cardIds: [...new Set(inRank.map((l) => l.klp.cardId))],
    })
  }
  return out
}
