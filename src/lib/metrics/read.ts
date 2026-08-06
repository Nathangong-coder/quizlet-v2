import type { HistoryScope } from '@/lib/memory/scope'
import type { LearnerProfile } from '@/lib/memory/topic-profile'
import type { Misconception } from '@/lib/metrics/misconceptions'
import type { ForgettingCurve } from '@/lib/metrics/forgetting'
import { deriveTagScores, toStoredTags } from '@/lib/errors/derive'
import { deriveMisconceptions, computeCleanStreaks } from '@/lib/metrics/misconceptions'
import { buildForgettingCurve, toRecallPairs } from '@/lib/metrics/forgetting'
import { shapeTopicProfile, composeLearnerProfile, toTopicRows } from '@/lib/memory/topic-profile'
import { buildLearnerProfile } from '@/lib/memory/profile'
import { eventRecalled, type StudySource } from '@/lib/memory/scoring'
import { paceOutliers as computePaceOutliers } from '@/lib/metrics/pace'
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

  const [cards, klpStates, tagRows, klpOutcomes, events] = await Promise.all([
    buildLearnerProfile({ userId, setId: scope.setIds[0] }),
    prisma.klpState.findMany({
      where: { userId },
      select: { klpId: true, pKnown: true, observations: true },
    }),
    prisma.answerErrorTag.findMany({
      where: { quizAnswer: { userId } },
      select: {
        dimension: true, type: true, klpId: true, secondaryKlpId: true,
        relevance: true, starred: true, magnitude: true, mode: true,
        severity: true, significance: true, quote: true, createdAt: true,
        quizAnswer: { select: { attemptId: true } },
      },
    }),
    prisma.answerKlpResult.findMany({
      where: { quizAnswer: { userId } },
      select: { klpId: true, status: true, createdAt: true },
    }),
    prisma.studyEvent.findMany({
      where: { userId },
      select: { cardId: true, correct: true, score: true, createdAt: true, source: true, latencyMs: true },
    }),
  ])

  const knowledge = Object.fromEntries(
    klpStates.map((s) => [s.klpId, { pKnown: s.pKnown, observations: s.observations }]),
  )

  const derived = deriveTagScores(toStoredTags(tagRows), bands)
  const topics = toTopicRows(await loadCategoryRows(prisma, userId, scope))

  // Analyzed-answer counts per topic. MUST come from QuizAnswer rows with
  // analysisStatus 'analyzed', NOT from the tags — a clean answer produces no
  // tags, and clean answers are precisely the positive evidence readiness
  // needs. Deriving this from tags would make every learner look unready.
  const analyzedAnswersByTopic = await loadAnalyzedAnswerCounts(prisma, userId, scope)

  const misconceptions = deriveMisconceptions({
    tags: tagRows
      .filter((t) => t.type === 'conflation' && t.klpId && t.secondaryKlpId)
      .map((t) => ({
        klpId: t.klpId as string,
        secondaryKlpId: t.secondaryKlpId as string,
        sessionId: t.quizAnswer.attemptId,
        quote: t.quote,
        createdAt: t.createdAt,
      })),
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
    paceOutliers: computePaceOutliers(
      events
        .filter((e): e is typeof e & { latencyMs: number } => typeof e.latencyMs === 'number')
        .map((e) => ({
          cardId: e.cardId,
          mode: e.source as StudySource,
          latencyMs: e.latencyMs,
          correct: eventRecalled(e),
        })),
    ),
  }
}

/**
 * Analyzed-answer count per topic key, from QuizAnswer rows whose
 * `analysisStatus` is 'analyzed'. Answers whose analysis was degraded
 * (`no_provenance`, `no_klps`, `failed`) are EXCLUDED: they are not evidence of
 * clean expression, only of analysis that could not run, and counting them
 * would inflate readiness for learners whose cards lack KLPs.
 *
 * Resolve each answer's card to its categories and increment every matching
 * normalized name, so an answer on a card in two topics counts once for each.
 */
async function loadAnalyzedAnswerCounts(
  prisma: PrismaClient,
  userId: string,
  scope: HistoryScope,
): Promise<Record<string, number>> {
  const answers = await prisma.quizAnswer.findMany({
    where: {
      userId,
      analysisStatus: 'analyzed',
      ...(scope.setIds.length > 0 ? { card: { setId: { in: scope.setIds } } } : {}),
    },
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
 * Query only — the shape mapping is `toTopicRows`, which is tested. Only LIVE
 * KLPs are selected: a superseded KLP belongs to an older version of the card
 * and its evidence should not count toward current knowledge.
 */
async function loadCategoryRows(prisma: PrismaClient, userId: string, scope: HistoryScope) {
  return prisma.cardCategory.findMany({
    where: {
      set: { userId, ...(scope.setIds.length > 0 ? { id: { in: scope.setIds } } : {}) },
      ...(scope.categoryKeys.length > 0 ? { normalizedName: { in: scope.categoryKeys } } : {}),
    },
    select: {
      normalizedName: true, name: true, color: true,
      assignments: {
        select: {
          card: { select: { klps: { where: { supersededAt: null }, select: { id: true } } } },
        },
      },
    },
  })
}
