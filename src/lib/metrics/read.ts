import type { HistoryScope } from '@/lib/memory/scope'
import type { LearnerProfile } from '@/lib/memory/topic-profile'
import type { Misconception } from '@/lib/metrics/misconceptions'
import type { ForgettingCurve } from '@/lib/metrics/forgetting'
import { deriveTagScores, toStoredTags } from '@/lib/errors/derive'
import { deriveMisconceptions, computeCleanStreaks, toConflationTags } from '@/lib/metrics/misconceptions'
import { buildForgettingCurve, toRecallPairs } from '@/lib/metrics/forgetting'
import { shapeTopicProfile, composeLearnerProfile, toTopicRows } from '@/lib/memory/topic-profile'
import { buildLearnerProfile } from '@/lib/memory/profile'
import { eventRecalled, type StudySource } from '@/lib/memory/scoring'
import { paceOutliers as computePaceOutliers } from '@/lib/metrics/pace'
import {
  buildStudyEventWhere, buildQuizAnswerScopeWhere, buildExpressionAnswerWhere,
  buildCategoryQuery,
} from '@/lib/memory/scope'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'
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
  bands?: BandTable
  now?: Date
}): Promise<LearnerMetrics> {
  const { prisma } = await import('@/lib/db')

  // Resolved once and shared by every scope-aware query below, so
  // misconceptions/forgetting/pace-outliers respect the same set, category,
  // card, and source scoping the topic profile already does — a request
  // scoped to one set must not answer with the learner's entire cross-set
  // retention curve and misconception list sitting behind it.
  const categoryIds = await resolveCategoryIds(prisma, userId, scope.categoryKeys)
  const quizAnswerScopeWhere = buildQuizAnswerScopeWhere(userId, scope, categoryIds)
  const studyEventWhere = buildStudyEventWhere(userId, scope, categoryIds)

  const [cards, klpStates, tagRows, klpOutcomes, events, attempts, paceBaseline] =
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
    // last N attempts" window. Deliberately NOT scoped: a clean sitting is
    // exactly what has to be visible, and scoping this would make the same
    // tag's significance depend on which view is asking — the bug this query
    // exists to fix, reintroduced one level down.
    prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }),
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
  ])

  const knowledge = Object.fromEntries(
    klpStates.map((s) => [s.klpId, { pKnown: s.pKnown, observations: s.observations }]),
  )

  const derived = deriveTagScores(
    toStoredTags(tagRows),
    bands,
    attempts.map((a) => a.id),
  )
  const topics = toTopicRows(await loadCategoryRows(prisma, userId, scope))

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

  return {
    profile: composeLearnerProfile(
      cards,
      shapeTopicProfile({ topics, knowledge, tags: derived, analyzedAnswersByTopic }),
    ),
    misconceptions,
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
            select: { id: true, klps: { select: { id: true, supersededAt: true } } },
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
async function resolveCategoryIds(
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
