'use server'

import { auth } from '@/auth'
import type { ActionResult } from '@/types/action'
import type { HistoryScope } from '@/lib/memory/scope'

import { getLearnerMetrics, resolveScopeCategoryIds, type LearnerMetrics } from '@/lib/metrics/read'
import { loadCoverage, diagnoseEmptyState, type DashboardCoverage, type EmptyCause } from '@/lib/metrics/coverage'
import { loadMissedWork } from '@/lib/metrics/klt-read'
import type { MissedTopic } from '@/lib/metrics/missed'
import { getUserTuning } from '@/lib/tuning/store'
import { resolveStudyScope } from '@/lib/tuning/study-scope'
import type { MetricThresholds, StrategyKey } from '@/lib/tuning/schema'

export interface LearnerDashboard {
  metrics: LearnerMetrics
  coverage: DashboardCoverage
  /** Why the page is thin, or null. See `diagnoseEmptyState`. */
  empty: EmptyCause | null
  /** The scope actually used, after stale references were resolved away. */
  appliedScope: HistoryScope
  /** True when the saved study scope is in force rather than a URL one. */
  defaultApplied: boolean
  /**
   * The saved scope resolved to nothing and was dropped. The page MUST say so
   * — a silent widening is the defect, not the widening itself.
   */
  widened: boolean
  staleSetIds: string[]
  staleCategoryKeys: string[]
  /** So copy can quote the learner's own floor instead of a literal 3. */
  thresholds: MetricThresholds
  /** So the ordering control can name the strategy without re-reading it. */
  strategy: StrategyKey
  /**
   * Spec §8 — what the learner actually got wrong, grouped by topic, each
   * entry carrying the specific recent misses that produced it.
   *
   * Separate from `metrics.ranked`: that answers "what should I study next"
   * under a chosen strategy, this answers "what have I been getting wrong".
   * A learner can have a full study list and nothing here (they have never
   * missed anything) or the reverse.
   */
  missed: MissedTopic[]
}

/**
 * One read for the whole learner dashboard.
 *
 * `urlScope` is null when the URL carried no scope at all, which is NOT the
 * same as an empty scope — see `hasExplicitScope`. Null means "no instruction,
 * use my saved default"; an empty scope means "show me everything", and a
 * saved default must not override it.
 *
 * A URL scope is used verbatim and is never resolved for staleness: a shared
 * or bookmarked link must show what it says, including nothing. Only the saved
 * default is resolved, because only it can silently rot as sets are deleted
 * and categories renamed.
 */
export async function getLearnerDashboard(
  urlScope: HistoryScope | null,
): Promise<ActionResult<LearnerDashboard>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Not signed in' }
  const userId = session.user.id

  try {
    const { prisma } = await import('@/lib/db')
    const tuning = await getUserTuning(userId)

    let appliedScope: HistoryScope
    let defaultApplied = false
    let widened = false
    let staleSetIds: string[] = []
    let staleCategoryKeys: string[] = []

    if (urlScope) {
      appliedScope = urlScope
    } else {
      // Resolve the saved scope against what currently EXISTS. Sets get
      // deleted and Stage 3.6 lets categories be renamed and merged, so this
      // is the steady state, not an edge case.
      const [sets, categories] = await Promise.all([
        prisma.set.findMany({ where: { userId }, select: { id: true } }),
        prisma.cardCategory.findMany({
          where: { set: { userId } },
          select: { normalizedName: true },
          distinct: ['normalizedName'],
        }),
      ])
      const resolved = resolveStudyScope(tuning.studyScope, {
        setIds: sets.map((s) => s.id),
        categoryKeys: categories.map((c) => c.normalizedName),
      })
      appliedScope = resolved.scope
      widened = resolved.widened
      staleSetIds = resolved.staleSetIds
      staleCategoryKeys = resolved.staleCategoryKeys
      // Only a scope that actually narrows something is "applied" — an empty
      // saved scope is indistinguishable from no preference, and announcing it
      // would put a "showing your saved scope" banner on every new account.
      defaultApplied =
        appliedScope.setIds.length > 0 || appliedScope.categoryKeys.length > 0
    }

    const floor = tuning.thresholds.minObservations
    const categoryIds = await resolveScopeCategoryIds(
      prisma,
      userId,
      appliedScope.categoryKeys,
    )

    const [metrics, coverage, missed] = await Promise.all([
      getLearnerMetrics({ userId, scope: appliedScope }),
      loadCoverage(prisma, userId, appliedScope, categoryIds, floor),
      loadMissedWork(prisma, userId, appliedScope, categoryIds, tuning.thresholds),
    ])

    const scoped =
      appliedScope.setIds.length > 0 ||
      appliedScope.categoryKeys.length > 0 ||
      Boolean(appliedScope.cardId)

    return {
      success: true,
      data: {
        metrics,
        coverage,
        empty: diagnoseEmptyState(coverage, scoped, floor),
        appliedScope,
        defaultApplied,
        widened,
        staleSetIds,
        staleCategoryKeys,
        thresholds: tuning.thresholds,
        strategy: tuning.strategy,
        missed,
      },
    }
  } catch (error) {
    console.error('Learner dashboard error:', error)
    return { success: false, error: 'Failed to load your learner profile' }
  }
}
