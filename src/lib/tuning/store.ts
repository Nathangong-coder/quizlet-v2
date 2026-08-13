import type { BandTable } from '@/lib/errors/bands'
import {
  resolveBands, resolveThresholds, shapeTuning,
  type MetricThresholds, type StrategyKey,
} from '@/lib/tuning/schema'

export interface ResolvedTuning {
  /** ALWAYS a complete table — see `resolveBands`. */
  bands: BandTable
  thresholds: MetricThresholds
  strategy: StrategyKey
}

/**
 * Server-side reader for the metric paths.
 *
 * Lives in `lib/`, NOT in `src/actions/learner-tuning.ts`, because
 * `src/lib/metrics/read.ts` consumes it and a lib module must not import a
 * `'use server'` action module — the same rule `read.ts`'s own
 * `resolveCategoryIds` comment states about `src/actions/memory.ts`.
 *
 * Returns FULLY RESOLVED values so callers never merge defaults themselves:
 * two call sites merging independently is how they drift, and a half-merged
 * band table silently downgrades every unlisted type to FALLBACK_BAND.
 *
 * `prisma` is imported dynamically so importing this module for its types
 * never touches `lib/db.ts`, which throws at import time without DATABASE_URL.
 */
export async function getUserTuning(userId: string): Promise<ResolvedTuning> {
  const { prisma } = await import('@/lib/db')
  const row = await prisma.learnerTuning.findUnique({
    where: { userId },
    select: { strategy: true, bands: true, thresholds: true },
  })
  const shaped = shapeTuning(row)
  return {
    bands: resolveBands(shaped.bandOverrides),
    thresholds: resolveThresholds(shaped.thresholdOverrides),
    strategy: shaped.strategy,
  }
}
