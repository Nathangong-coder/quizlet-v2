import type { HistoryScope } from '@/lib/memory/scope'
import type { LearnerProfile } from '@/lib/memory/topic-profile'
import type { Misconception } from '@/lib/metrics/misconceptions'
import type { ForgettingCurve } from '@/lib/metrics/forgetting'
import { deriveTagScores, toStoredTags } from '@/lib/errors/derive'
import { deriveMisconceptions, computeCleanStreaks, toConflationTags } from '@/lib/metrics/misconceptions'
import { buildForgettingCurve, toRecallPairs } from '@/lib/metrics/forgetting'
import {
  shapeTopicProfile, composeLearnerProfile, toTopicRows, kltRowsToTopicRows,
  type RawKltRow, type LearnerTopicProfile,
} from '@/lib/memory/topic-profile'
import { buildLearnerProfile } from '@/lib/memory/profile'
import { eventRecalled, type StudySource } from '@/lib/memory/scoring'
import { paceOutliers as computePaceOutliers } from '@/lib/metrics/pace'
import {
  rollUpKltLinks, buildAncestorClosureByName, buildAncestorBreadcrumbByName,
  countAnalyzedAnswersByTopic, type KltNodeRow,
} from '@/lib/metrics/klt-rollup'
import { selectDisplayDepth } from '@/lib/metrics/klt-depth'
import {
  buildStudyEventWhere, buildQuizAnswerScopeWhere, buildExpressionAnswerWhere,
  buildCategoryQuery, buildCardScopeWhere,
} from '@/lib/memory/scope'
import { getUserTuning } from '@/lib/tuning/store'
import { rankCandidates, toRankCandidates, type RankedCandidate } from '@/lib/metrics/targeting'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'
import { loadAnsweredAttemptIds } from '@/lib/quiz/history'
import type { BandTable } from '@/lib/errors/bands'
import type { PrismaClient } from '@prisma/client'

export interface LearnerMetrics {
  profile: LearnerProfile
  misconceptions: Misconception[]
  forgetting: ForgettingCurve | null
  /**
   * "Correct but not fluent" cards: answered right, but slowly enough
   * relative to the learner's own baseline IN THAT MODE to be worth
   * flagging. Spans every mode the learner has timed answers in — each
   * scored against its own baseline, never mixed with another mode's — so a
   * card can appear once per mode it qualifies in. See `paceOutliers`'s
   * doc comment (`@/lib/metrics/pace`) for why a single fixed mode would
   * silently hide real findings in an MC/TF-heavy corpus.
   */
  paceOutliers: { cardId: string; mode: StudySource; index: number }[]
  /**
   * KLP-grain study candidates under the learner's chosen strategy, best first.
   * Sub-threshold candidates are present but sort last and carry
   * `sufficient: false` — see `rankCandidates`.
   *
   * Rendered by `/profile/learner` via `StudyNext`.
   */
  ranked: RankedCandidate[]
  /**
   * The AI-derived topic axis (KLTs), scored by the SAME `shapeTopicProfile`
   * as the user-authored category axis in `profile.topics`.
   *
   * Computed HERE rather than in a module of its own so both axes read the
   * identical `derived` tags, `knowledge` map and thresholds. A second module
   * would have to rebuild the whole tag-derivation pipeline, and two copies of
   * it would drift into disagreeing about what "weak" means on one screen.
   *
   * Lives BESIDE `profile.topics`, never replacing it — a user category and an
   * AI topic answer different questions and `CLAUDE.md`'s 2026-08-14 note is
   * why: a category is often a FORMAT label ("label the image"), which makes a
   * poor concept node but a perfectly good filter.
   */
  kltTopics: LearnerTopicProfile[]
  /**
   * Which tree depth `kltTopics` is showing (0 at a subject root), chosen by
   * `selectDisplayDepth` — the DEEPEST level where at least
   * `MIN_TOPICS_AT_DEPTH` topics clear the observation floor, falling back to
   * the shallowest populated level when none do. `null` only when the learner
   * has no KLT tree at all, in which case `kltTopics` is also empty.
   *
   * Showing every depth at once was the wall of "not measured" rows that
   * motivated this task — see the doc comment on `klt-depth.ts`.
   */
  displayDepth: number | null
  /**
   * Ancestor display names (root first, excluding self) for each entry in
   * `kltTopics`, keyed by `LearnerTopicProfile.key`. Built from the same
   * `Klt` fetch `kltTopics` is derived from, restricted to the topics actually
   * shown — a topic at another depth has no row here since it never renders.
   *
   * Empty array (never absent) for a depth-0 topic, which has no ancestors —
   * `TopicMastery` treats an empty breadcrumb as "nothing to show" rather than
   * distinguishing the two, so either shape renders identically.
   */
  kltBreadcrumbs: Record<string, string[]>
  /**
   * What each candidate SAYS, keyed by `klpId`.
   *
   * Separate from `ranked` rather than folded into it, so `targeting.ts` stays a
   * scoring module with no prose in it. A missing entry is possible in
   * principle — the map is built from the same rows the candidates are — and
   * callers must fall back rather than render `undefined`.
   */
  candidateLabels: Record<string, CandidateLabel>
}

/** The human-readable half of a study candidate. */
export interface CandidateLabel {
  /** The KLP proposition itself. */
  text: string
  /** The term of the card it belongs to. */
  term: string
  /**
   * The short headline, null until the KLT pass has run for this card.
   *
   * Carried SEPARATELY from `text` rather than replacing it: the row shows the
   * headline, the proposition stays available underneath, and a KLP with no
   * usable label still renders. Without this field the ranked list shows the
   * full ~16-word proposition on every row — which is the wall of sentences the
   * KLT layer exists to remove.
   */
  label: string | null
}

/**
 * Thin DB shell. Deliberately untested here — no DB-mocking precedent exists
 * in this suite, and every computation it delegates to is covered by the pure
 * modules' own tests. See the same note on `buildLearnerProfile`.
 *
 * `prisma` is imported DYNAMICALLY so importing this module for its types
 * never touches `lib/db.ts`, which throws at import time without DATABASE_URL.
 */
export async function getLearnerMetrics({
  userId,
  scope,
  bands,
  now = new Date(),
}: {
  userId: string
  scope: HistoryScope
  /**
   * PREVIEW OVERRIDE, not the primary path: the learner's stored bands are
   * resolved below and used by default. An explicit table wins so the settings
   * panel can show "what would this look like" without saving first. It must be
   * a FULLY RESOLVED table (`resolveBands`) — `resolveSeverity` replaces rather
   * than merges, so a partial one silently downgrades every unlisted type to
   * FALLBACK_BAND.
   */
  bands?: BandTable
  now?: Date
}): Promise<LearnerMetrics> {
  const { prisma } = await import('@/lib/db')

  // The learner's own knobs, resolved once and threaded into every derivation
  // below. Nothing here writes or replays: bands and thresholds never reach
  // BKT, so a retune changes what the next read computes and nothing else.
  const tuning = await getUserTuning(userId)
  const effectiveBands = bands ?? tuning.bands

  // Resolved once and shared by every scope-aware query below, so
  // misconceptions/forgetting/pace-outliers respect the same set, category,
  // card, and source scoping the topic profile already does — a request
  // scoped to one set must not answer with the learner's entire cross-set
  // retention curve and misconception list sitting behind it.
  const categoryIds = await resolveScopeCategoryIds(prisma, userId, scope.categoryKeys)
  const quizAnswerScopeWhere = buildQuizAnswerScopeWhere(userId, scope, categoryIds)
  const studyEventWhere = buildStudyEventWhere(userId, scope, categoryIds)

  // `buildCardScopeWhere` (exported for exactly this kind of reuse) rather than
  // a second filter written here that can drift from the one every other query
  // uses. CardProgress has its own scalar `cardId`, which is the narrowest
  // scope and subsumes set/category — the same branching `buildStudyEventWhere`
  // and `buildLearnerProfile` both apply.
  const cardProgressScope: Record<string, unknown> = {}
  if (scope.cardId) {
    cardProgressScope.cardId = scope.cardId
  } else {
    const card = buildCardScopeWhere(scope, categoryIds)
    if (Object.keys(card).length > 0) cardProgressScope.card = card
  }

  const [cards, klpStates, tagRows, klpOutcomes, events, attemptIds, paceBaseline, progressRows] =
    await Promise.all([
    // The full scope, not just `setIds` — `shapeTopicProfile` below honours
    // every dimension, and the two are returned in one `LearnerProfile`.
    buildLearnerProfile({ userId, scope, categoryIds }),
    // Deliberately NOT scoped: `shapeTopicProfile` re-filters knowledge by
    // each topic's own klpId set, so an out-of-scope KLP's pKnown is never
    // read regardless of what this query returns.
    prisma.klpState.findMany({
      where: { userId },
      select: { klpId: true, pKnown: true, observations: true },
    }),
    prisma.answerErrorTag.findMany({
      // `analysisStatus: 'analyzed'` makes this — readiness's NUMERATOR —
      // share a population with `loadAnalyzedAnswerCounts`, its denominator,
      // which has always counted analyzed answers only. Without it, the
      // whole-answer clarity/conciseness tags `buildAnalysisWrites` still
      // writes under `no_klps`/`no_provenance` added expression weight with no
      // matching answer underneath: a topic whose cards have no key points yet
      // read as far less ready than it was, and could pin to 0.
      //
      // Not restricted to short answer, though the denominator is: MC/TF tags
      // are always `dimension: 'accuracy'`, which `computeArticulation`
      // ignores, and `deriveMisconceptions` below legitimately spans modes.
      where: { quizAnswer: { ...quizAnswerScopeWhere, analysisStatus: 'analyzed' } },
      select: {
        dimension: true, type: true, klpId: true, secondaryKlpId: true,
        relevance: true, starred: true, magnitude: true, mode: true,
        severity: true, significance: true, quote: true, createdAt: true,
        // `cardId` is what ties a WHOLE-ANSWER tag (klpId null) to a topic;
        // without it those tags are dropped from readiness entirely.
        quizAnswer: { select: { attemptId: true, cardId: true } },
      },
    }),
    prisma.answerKlpResult.findMany({
      where: { quizAnswer: quizAnswerScopeWhere },
      select: { klpId: true, status: true, createdAt: true },
    }),
    prisma.studyEvent.findMany({
      where: studyEventWhere,
      select: { cardId: true, correct: true, score: true, createdAt: true, source: true, latencyMs: true },
    }),
    // The learner's REAL attempt sequence, for `repeatBonus`'s "within the
    // last N attempts" window — answered attempts only, unscoped, oldest
    // first. Shared with the quiz results screen through one helper because
    // the two must agree exactly; see its doc comment.
    loadAnsweredAttemptIds(prisma, userId),
    // The pace BASELINE, deliberately NOT scoped — for the same reason the
    // attempts query above isn't. A learner's normal speed in a mode is a
    // property of the learner, not of the view asking. Drawing it from the
    // scoped events made a card-scoped request degenerate: the filtered set is
    // that card's own events, so its median IS the baseline and the index is
    // exactly 1.0 — a 2.4x outlier reported as no fluency problem at all.
    //
    // Only timed rows, and capped, since this is the one query here whose size
    // does not shrink with the scope.
    prisma.studyEvent.findMany({
      where: { userId, latencyMs: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: PACE_BASELINE_FETCH_CAP,
      select: {
        cardId: true, source: true, latencyMs: true,
        correct: true, score: true, createdAt: true,
      },
    }),
    // Due state for the `follow_forgetting` candidates. Scoped, unlike the two
    // queries above: a due date is a property of this learner's schedule for a
    // card, so narrowing the view legitimately narrows the candidate set.
    prisma.cardProgress.findMany({
      where: { userId, ...cardProgressScope },
      select: { cardId: true, dueAt: true },
    }),
  ])

  const knowledge = Object.fromEntries(
    klpStates.map((s) => [s.klpId, { pKnown: s.pKnown, observations: s.observations }]),
  )

  const derived = deriveTagScores(
    toStoredTags(tagRows),
    effectiveBands,
    attemptIds,
  )

  const categoryRows = await loadCategoryRows(prisma, userId, scope)
  const topics = toTopicRows(categoryRows)

  // Spec 3C Task 4B. Candidates are assembled category -> card -> live KLP, so
  // before this a card with no category was in no topic and therefore in no
  // candidate list — even though KlpState holds a real posterior for its KLPs.
  // The 3B live gate found a library with 68 KLP-bearing cards and 4
  // categorized ones, ZERO overlap: an empty study list however much the
  // learner studied, indistinguishable from a broken feature.
  //
  // Safe because only ONE of the four score inputs is topic-derived
  // (`readiness`), and `articulationGap` already reads null as "no articulation
  // problem". The topic was load-bearing for the QUERY SHAPE, not the scoring.
  const uncategorized = includeUncategorized(scope)
    ? await loadUncategorizedCards(prisma, userId, scope)
    : []

  // Weights and card ids for the candidates, built from the SAME rows
  // `toTopicRows` consumes so there is one query rather than two.
  const klpWeights: Record<string, number> = {}
  const klpCardIds: Record<string, string> = {}
  // Display labels, gathered in the SAME walk rather than a second query. Kept
  // out of `RankCandidate` deliberately: `targeting.ts` scores, and a module
  // that scores should not carry prose it never reads.
  const candidateLabels: Record<string, CandidateLabel> = {}
  for (const c of categoryRows) {
    for (const a of c.assignments) {
      for (const k of a.card.klps) {
        klpWeights[k.id] = k.weight
        klpCardIds[k.id] = a.card.id
        candidateLabels[k.id] = { text: k.text, term: a.card.term, label: k.label }
      }
    }
  }
  for (const card of uncategorized) {
    for (const k of card.klps) {
      klpWeights[k.id] = k.weight
      klpCardIds[k.id] = card.id
      candidateLabels[k.id] = { text: k.text, term: card.term, label: k.label }
    }
  }

  // Analyzed-answer counts per topic. MUST come from QuizAnswer rows with
  // analysisStatus 'analyzed', NOT from the tags — a clean answer produces no
  // tags, and clean answers are precisely the positive evidence readiness
  // needs. Deriving this from tags would make every learner look unready.
  //
  // Scoped by the SAME `quizAnswerScopeWhere` the tag query above uses: this
  // count is readiness's denominator and the tags are its numerator, so any
  // scope the numerator honours and the denominator doesn't inflates
  // readiness — the narrower the scope, the worse the overstatement.
  const analyzedAnswersByTopic = await loadAnalyzedAnswerCounts(prisma, quizAnswerScopeWhere)

  const misconceptions = deriveMisconceptions({
    tags: toConflationTags(tagRows),
    cleanStreaks: computeCleanStreaks(
      klpOutcomes.map((o) => ({
        klpId: o.klpId,
        status: o.status as 'passed' | 'partial' | 'failed',
        createdAt: o.createdAt,
      })),
    ),
    now,
  })

  const shapedTopics = shapeTopicProfile({
    topics, knowledge, tags: derived, analyzedAnswersByTopic,
    thresholds: tuning.thresholds,
  })

  // The KLT axis, from the same inputs. `masteryTopicRanks` decides how many
  // of a KLP's ranked topics count — 3 by default, so one point can move
  // several topics (spec §9.1).
  const { topics: kltRows, closuresBySet, breadcrumbByName } =
    await loadKltRows(prisma, userId, scope, categoryIds)
  const kltTopicRows = kltRowsToTopicRows(kltRows, tuning.thresholds.masteryTopicRanks)
  const kltTopicsAll = kltTopicRows.length === 0 ? [] : shapeTopicProfile({
    topics: kltTopicRows,
    knowledge,
    tags: derived,
    analyzedAnswersByTopic: await loadAnalyzedAnswerCountsByKlt(
      prisma, quizAnswerScopeWhere, tuning.thresholds.masteryTopicRanks, closuresBySet,
    ),
    thresholds: tuning.thresholds,
  })

  // Task 8: pick ONE depth to show rather than the whole tree at once — a
  // library with 68 leaf topics all reading "not measured" on a thin corpus
  // is the exact complaint this exists to answer. `depth` is null only for
  // the user-authored CATEGORY axis (a different array, `shapedTopics`,
  // never this one) — `kltRowsToTopicRows` always sets it for a KLT row, so
  // the `continue` below is a defensive skip, not a real path today.
  const measuredByDepth = new Map<number, number>()
  const populatedDepths: number[] = []
  for (const t of kltTopicsAll) {
    if (t.depth === null) continue
    populatedDepths.push(t.depth)
    if (t.knowledge !== null) {
      measuredByDepth.set(t.depth, (measuredByDepth.get(t.depth) ?? 0) + 1)
    }
  }
  const displayDepth = selectDisplayDepth(measuredByDepth, populatedDepths)
  const kltTopics = displayDepth === null
    ? []
    : kltTopicsAll.filter((t) => t.depth === displayDepth)

  // Breadcrumbs only for the topics actually shown — a topic at a depth that
  // lost the selection never renders, so it never needs an ancestor path.
  const kltBreadcrumbs: Record<string, string[]> = {}
  for (const t of kltTopics) {
    kltBreadcrumbs[t.key] = breadcrumbByName.get(t.key) ?? []
  }

  // LIVE ids only. `supersededKlpIds` exists for TAG ATTRIBUTION — a historical
  // tag names the version that was asked — and must never become a study
  // target: that KLP describes a version of the card the learner cannot see.
  const liveKlpIdsByTopic: Record<string, string[]> = {}
  for (const t of topics) {
    ;(liveKlpIdsByTopic[t.normalizedName] ??= []).push(...t.klpIds)
  }

  // The Uncategorized bucket goes LAST and ONLY here. It is a targeting group,
  // never a `LearnerTopicProfile` row: a grab-bag is not a concept, and a
  // knowledge rollup over it would invent one and average across unrelated
  // material. `readiness` is null because there is no topic to have measured.
  //
  // Last also matters mechanically — `toRankCandidates` gives a duplicate KLP
  // to the FIRST topic claiming it, so a real category always wins attribution.
  const uncategorizedGroup =
    uncategorized.length > 0
      ? [
          {
            key: UNCATEGORIZED_ID,
            klpIds: uncategorized.flatMap((c) => c.klps.map((k) => k.id)),
            readiness: null,
          },
        ]
      : []

  const ranked = rankCandidates(
    toRankCandidates({
      topics: [
        ...shapedTopics.map((t) => ({
          key: t.key,
          klpIds: [...new Set(liveKlpIdsByTopic[t.key] ?? [])],
          readiness: t.readiness,
        })),
        ...uncategorizedGroup,
      ],
      klpWeights,
      knowledge,
      klpCardIds,
      dueByCard: Object.fromEntries(
        progressRows
          .filter((p): p is { cardId: string; dueAt: Date } => p.dueAt !== null)
          .map((p) => [p.cardId, p.dueAt]),
      ),
    }),
    tuning.strategy,
    { now, thresholds: tuning.thresholds },
  )

  return {
    profile: composeLearnerProfile(cards, shapedTopics),
    misconceptions,
    ranked,
    kltTopics,
    displayDepth,
    kltBreadcrumbs,
    candidateLabels,
    // `StudyEvent.correct` is NULL for short-answer rows (they carry a
    // `score`, not a boolean) — mapping raw `correct` straight through would
    // drop every short-answer exposure from the curve AND break the pairing
    // chain around it. `eventRecalled` already knows how to read both shapes
    // and apply the one named recall threshold.
    forgetting: buildForgettingCurve(
      toRecallPairs(
        events.map((e) => ({
          cardId: e.cardId,
          correct: eventRecalled(e),
          createdAt: e.createdAt,
        })),
      ),
    ),
    // Candidates are scoped; the baseline they are judged against is not.
    paceOutliers: computePaceOutliers(
      toTimedEvents(events),
      undefined,
      toTimedEvents(paceBaseline),
    ),
  }
}

/**
 * Bound on the unscoped pace-baseline read. Every other query here narrows
 * with the scope; this one deliberately does not, so it gets an explicit cap
 * rather than an unbounded lifetime scan. Most-recent-first, so the baseline
 * tracks the learner's current speed rather than averaging in how slow they
 * were a year ago.
 */
const PACE_BASELINE_FETCH_CAP = 5000

/** Rows with a real latency, in the shape `paceOutliers` consumes. */
function toTimedEvents(
  rows: {
    cardId: string
    source: string
    latencyMs: number | null
    correct: boolean | null
    score: number | null
    createdAt: Date
  }[],
) {
  return rows
    .filter((e): e is typeof e & { latencyMs: number } => typeof e.latencyMs === 'number')
    .map((e) => ({
      cardId: e.cardId,
      mode: e.source as StudySource,
      latencyMs: e.latencyMs,
      // `StudyEvent.correct` is NULL for short answer (it carries a score);
      // `eventRecalled` reads both shapes against the one recall threshold.
      correct: eventRecalled(e),
    }))
}

/**
 * Analyzed SHORT-ANSWER count per topic key. Answers whose analysis was
 * degraded (`no_provenance`, `no_klps`, `failed`) are EXCLUDED: they are not
 * evidence of clean expression, only of analysis that could not run, and
 * counting them would inflate readiness for learners whose cards lack KLPs.
 *
 * Restricted to short answer by `buildExpressionAnswerWhere` — see its doc
 * comment and `EXPRESSION_QUIZ_MODE` for why an all-modes denominator inverts
 * the metric.
 *
 * Resolve each answer's card to its categories and increment every matching
 * normalized name, so an answer on a card in two topics counts once for each.
 *
 * Takes the caller's already-built `buildQuizAnswerScopeWhere` fragment rather
 * than a `HistoryScope`, so the full scope (sets, categories, cardId, source)
 * is honoured by exactly the tested builder the tag query uses — not by a
 * second, narrower filter written here that can drift from it.
 */
async function loadAnalyzedAnswerCounts(
  prisma: PrismaClient,
  quizAnswerScopeWhere: Record<string, unknown>,
): Promise<Record<string, number>> {
  const answers = await prisma.quizAnswer.findMany({
    where: buildExpressionAnswerWhere(quizAnswerScopeWhere),
    select: {
      card: {
        select: {
          categoryAssignments: { select: { category: { select: { normalizedName: true } } } },
        },
      },
    },
  })

  const counts: Record<string, number> = {}
  for (const a of answers) {
    for (const assignment of a.card?.categoryAssignments ?? []) {
      const key = assignment.category.normalizedName
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return counts
}

/**
 * Whether the Uncategorized targeting bucket belongs in this request.
 *
 * Pure and exported so the rule is tested directly: an empty `categoryKeys`
 * means every category AND the uncategorized remainder, while a scope naming
 * real categories deliberately excludes it — the learner asked for those
 * topics. `UNCATEGORIZED_ID` opts it back in, matching `buildCardScopeWhere`,
 * where the sentinel is already a first-class bucket.
 */
export function includeUncategorized(scope: HistoryScope): boolean {
  return scope.categoryKeys.length === 0 || scope.categoryKeys.includes(UNCATEGORIZED_ID)
}

/**
 * The learner's cards that have live KLPs and NO category, honouring the
 * scope's card and set dimensions.
 *
 * Ownership runs through the set, exactly as `loadCategoryRows` does —
 * `Card` has no userId of its own, and a missing `set: { userId }` here would
 * hand another learner's propositions back as study targets.
 *
 * Live KLPs only, in both the filter and the select. A superseded KLP describes
 * a version of the card the learner can no longer see.
 */
async function loadUncategorizedCards(
  prisma: PrismaClient,
  userId: string,
  scope: HistoryScope,
) {
  const where: Record<string, unknown> = {
    set: { userId },
    categoryAssignments: { none: {} },
    klps: { some: { supersededAt: null } },
  }
  // cardId is the narrowest scope and subsumes setIds, the same precedence
  // every other builder in `@/lib/memory/scope` applies.
  if (scope.cardId) where.id = scope.cardId
  else if (scope.setIds.length > 0) where.setId = { in: scope.setIds }

  return prisma.card.findMany({
    where,
    select: {
      id: true,
      // `term` and `text` are LABELS, not inputs to any score. Without them the
      // study list can only render "Key point" for every row — which on a
      // library where most cards are uncategorized is the entire list.
      term: true,
      klps: {
        where: { supersededAt: null },
        select: { id: true, weight: true, text: true, label: true },
      },
    },
  })
}

/**
 * Query only — the shape mapping is `toTopicRows` and the scope shaping is
 * `buildCategoryQuery`, both tested.
 *
 * EVERY version of each KLP is selected, live and superseded, and `toTopicRows`
 * splits them. Knowledge still uses live ids only — a superseded KLP belongs to
 * an older version of the card and its evidence must not count toward current
 * knowledge — but TAG ATTRIBUTION needs the retired ones: a historical tag
 * references the version that was live when the answer was given. Filtering
 * them out here dropped every past tag on an edited card from readiness's
 * numerator while its answers stayed in the denominator, so readiness jumped
 * toward 1.0 on a card edit, with no change in the learner's behaviour.
 */
/**
 * KLT rows for the cards in scope, rolled up over the concept TREE —
 * PER SET, then unioned (Task 3, spec §6.2).
 *
 * Structure moved off the global `Klt` tree onto `SetKltNode`: one row per
 * (set, concept), where the SAME concept can sit under a different parent at
 * a different depth in a different set. Resolving all sets' rows in one fold
 * (as the old global-tree version did) would credit a leaf's links to an
 * ancestor chain that is not its own the moment two sets disagree about where
 * a shared concept sits — so this groups `SetKltNode` rows BY SET and calls
 * `rollUpKltLinks` once per set, then concatenates the results. A concept
 * present in two sets therefore produces two `RawKltRow` entries sharing a
 * `normalizedName`; `kltRowsToTopicRows`/`shapeTopicProfile` (unchanged) group
 * by that name and deduplicate `klpIds` through a `Set`, which is what turns
 * the concatenation into a union rather than a double count.
 *
 * Scoped to the sets in the learner's scope — `set: { userId }` plus,
 * when the scope names sets, `setId: { in: scope.setIds }` — never the whole
 * `SetKltNode` table. This is also what makes the `ancestorIds` GIN index
 * usable: the old global-`Klt` read fetched every concept in the install
 * regardless of scope.
 *
 * The nested `links` filter repeats the card scope on purpose, ONE SET AT A
 * TIME. Without it a node that qualifies through ONE in-scope card drags in
 * its links from every other card in the database — including other users' —
 * and the topic's knowledge would be averaged over KLPs this learner has
 * never seen.
 *
 * Also returns `closuresBySet` — one ancestor-closure map PER SET, keyed by
 * setId, threaded into `loadAnalyzedAnswerCountsByKlt` rather than re-querying
 * `SetKltNode` a second time there. Readiness's denominator needs the
 * identical per-set ancestor fold the links (its numerator) already get; see
 * `buildAncestorClosureByName`'s doc comment for why (review finding,
 * 2026-08-25) — kept ONE PER SET, not merged, because two sets may disagree
 * about a shared concept's ancestors (§6.2) and a single merged map would let
 * one set's structure silently answer for another's.
 *
 * And `breadcrumbByName` — every node's ancestors as DISPLAY names, first set
 * to name a given topic wins — for Task 8's breadcrumb. A topic present in
 * two sets has no single correct breadcrumb (§6.2's accepted divergence); a
 * stable "first seen" choice is preferable to a `Map.set` last-write that
 * would vary with query order.
 *
 * A set with no `SetKltNode` rows at all (structure never placed) simply
 * contributes nothing — no throw, no topics, exactly the "empty structure"
 * case Task 3's tests require.
 */
async function loadKltRows(
  prisma: PrismaClient,
  userId: string,
  scope: HistoryScope,
  categoryIds: string[],
): Promise<{
  topics: RawKltRow[]
  closuresBySet: Map<string, Map<string, string[]>>
  breadcrumbByName: Map<string, string[]>
}> {
  const nodeRows = await prisma.setKltNode.findMany({
    where: {
      set: { userId },
      ...(scope.setIds.length > 0 ? { setId: { in: scope.setIds } } : {}),
    },
    select: {
      setId: true,
      kltId: true,
      depth: true,
      ancestorIds: true,
      klt: { select: { normalizedName: true, name: true } },
    },
  })

  const bySet = new Map<string, typeof nodeRows>()
  for (const row of nodeRows) {
    const list = bySet.get(row.setId)
    if (list) list.push(row)
    else bySet.set(row.setId, [row])
  }

  const topics: RawKltRow[] = []
  const closuresBySet = new Map<string, Map<string, string[]>>()
  const breadcrumbByName = new Map<string, string[]>()

  for (const [setId, rowsForSet] of bySet) {
    // cardId subsumes the category dimension, mirroring `buildStudyEventWhere`/
    // `buildQuizAnswerScopeWhere`'s "narrowest scope wins" convention — a
    // single-card scope makes "which categories" moot. `setId` is always
    // pinned to THIS set, never `scope.setIds` (which may name several) —
    // placed AFTER the spread so it always wins over whatever
    // `buildCardScopeWhere` set from the (possibly multi-set) scope.
    const card: Record<string, unknown> = scope.cardId
      ? { id: scope.cardId, setId, set: { userId } }
      : { ...buildCardScopeWhere(scope, categoryIds), setId, set: { userId } }

    const links = await prisma.klpTopic.findMany({
      where: { kltId: { in: rowsForSet.map((r) => r.kltId) }, klp: { card } },
      select: { kltId: true, rank: true, klp: { select: { id: true, supersededAt: true, cardId: true } } },
    })
    const linksByKltId = new Map<string, RawKltRow['links']>()
    for (const l of links) {
      const entry = { rank: l.rank, klp: l.klp }
      const list = linksByKltId.get(l.kltId)
      if (list) list.push(entry)
      else linksByKltId.set(l.kltId, [entry])
    }

    const kltNodeRows: KltNodeRow[] = rowsForSet.map((r) => ({
      kltId: r.kltId,
      normalizedName: r.klt.normalizedName,
      name: r.klt.name,
      depth: r.depth,
      ancestorIds: r.ancestorIds,
      links: linksByKltId.get(r.kltId) ?? [],
    }))

    topics.push(...rollUpKltLinks(kltNodeRows))
    closuresBySet.set(setId, buildAncestorClosureByName(kltNodeRows))
    for (const [name, crumb] of buildAncestorBreadcrumbByName(kltNodeRows)) {
      if (!breadcrumbByName.has(name)) breadcrumbByName.set(name, crumb)
    }
  }

  return { topics, closuresBySet, breadcrumbByName }
}

/**
 * Analyzed-answer counts per KLT — readiness's DENOMINATOR on that axis.
 *
 * Counted from answers, never from tags, for the reason spelled out on
 * `loadAnalyzedAnswerCounts`: a clean answer produces no tags and is exactly
 * the positive evidence readiness needs, so deriving this from tags would make
 * every learner look maximally unready.
 *
 * Per-set-then-union (Task 3, spec §6.2), matching `loadKltRows`'s numerator:
 * every answer's card belongs to exactly ONE set, so its direct topic names
 * must climb THAT set's ancestor chain, never another set's — grouping
 * answers by `card.setId` and folding each group through `closuresBySet`
 * before summing is what keeps the denominator, like the numerator, from
 * letting one set's structure answer for another's. Summing counts across
 * sets (rather than deduplicating, the way the numerator's `klpIds` are) is
 * correct here: each answer is a real event that appears in exactly one set's
 * group, so the sum is total evidence, not a double count.
 *
 * A set absent from `closuresBySet` (no placed structure) falls back to an
 * empty closure — `countAnalyzedAnswersByTopic` then credits only the direct
 * topic name, which is unused chart data since `loadKltRows` produced no
 * `RawKltRow` for that set's concepts either; it is harmless, not a throw.
 */
async function loadAnalyzedAnswerCountsByKlt(
  prisma: PrismaClient,
  quizAnswerScopeWhere: Record<string, unknown>,
  maxRank: number,
  closuresBySet: Map<string, Map<string, string[]>>,
): Promise<Record<string, number>> {
  const answers = await prisma.quizAnswer.findMany({
    where: buildExpressionAnswerWhere(quizAnswerScopeWhere),
    select: {
      card: {
        select: {
          setId: true,
          klps: {
            where: { supersededAt: null },
            select: {
              topics: {
                where: { rank: { lte: maxRank } },
                select: { klt: { select: { normalizedName: true } } },
              },
            },
          },
        },
      },
    },
  })

  const answersBySet = new Map<string, { topicNames: string[] }[]>()
  for (const a of answers) {
    const setId = a.card?.setId
    if (!setId) continue
    const topicNames = (a.card?.klps ?? []).flatMap((klp) => klp.topics.map((t) => t.klt.normalizedName))
    const list = answersBySet.get(setId)
    if (list) list.push({ topicNames })
    else answersBySet.set(setId, [{ topicNames }])
  }

  const counts: Record<string, number> = {}
  for (const [setId, setAnswers] of answersBySet) {
    const setCounts = countAnalyzedAnswersByTopic(setAnswers, closuresBySet.get(setId) ?? new Map())
    for (const [key, count] of Object.entries(setCounts)) {
      counts[key] = (counts[key] ?? 0) + count
    }
  }
  return counts
}

async function loadCategoryRows(prisma: PrismaClient, userId: string, scope: HistoryScope) {
  const { where, assignmentWhere } = buildCategoryQuery(userId, scope)
  return prisma.cardCategory.findMany({
    where,
    select: {
      normalizedName: true, name: true, color: true,
      assignments: {
        where: assignmentWhere,
        select: {
          card: {
            select: {
              id: true,
              // LABELS, not score inputs — see `loadUncategorizedCards`.
              term: true,
              // `weight` and `cardId` are for Spec 3B's ranking candidates;
              // `supersededAt` is what `toTopicRows` splits live from retired on.
              klps: {
                select: {
                  id: true, supersededAt: true, weight: true, cardId: true, text: true,
                  label: true,
                },
              },
            },
          },
        },
      },
    },
  })
}

/**
 * Resolve a scope's cross-set category keys (normalized names) to the
 * concrete per-set CardCategory ids they cover, restricted to sets this user
 * owns — required by `buildQuizAnswerScopeWhere`/`buildStudyEventWhere`,
 * which take resolved ids rather than names.
 *
 * Mirrors `resolveCategoryIds` in `src/actions/memory.ts` (not imported from
 * there: that file is a 'use server' action module, the wrong dependency
 * direction for a lib module to reach into). The only branching here is
 * "skip the UNCATEGORIZED_ID sentinel, and skip the query entirely once
 * nothing named is left" — a query-shaping guard, not a decision. The actual
 * decision (how UNCATEGORIZED_ID combines with named categories) lives in
 * the pure, tested `buildCardScopeWhere` inside `@/lib/memory/scope`.
 */
export async function resolveScopeCategoryIds(
  prisma: PrismaClient,
  userId: string,
  categoryKeys: string[],
): Promise<string[]> {
  const named = categoryKeys.filter((key) => key !== UNCATEGORIZED_ID)
  if (named.length === 0) return []

  const rows = await prisma.cardCategory.findMany({
    where: { set: { userId }, normalizedName: { in: named } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}
