import type { Dimension } from '@/lib/errors/taxonomy'
import type { KlpStatus } from '@/lib/errors/klp-credit'
import type { AnalysisOutcome } from './persist'

const MAX_STRUGGLED_KLPS = 5

export interface RollupKlpResult {
  klpId: string
  status: KlpStatus
}

export interface RollupErrorTag {
  dimension: Dimension
  type: string
  klpId: string | null
  significance: number
}

export interface RollupAnswer {
  analysisStatus: AnalysisOutcome | null
  klpResults: RollupKlpResult[]
  errorTags: RollupErrorTag[]
}

export interface SessionRollup {
  analyzedCount: number
  totalCount: number
  errorsByDimension: Record<Dimension, number>
  errorsByType: { type: string; dimension: Dimension; count: number }[]
  struggledKlps: { klpId: string; failCount: number; totalSignificance: number }[]
}

/**
 * Same-session tally of what Spec 2a already captured. No AI call, no query —
 * pure arithmetic over rows the caller already fetched.
 *
 * Deliberately NOT a mastery score, a BKT update, or anything cross-attempt —
 * that's Spec 3, which needs a real corpus and per-KLP history this function
 * never sees. This only describes the one session on screen.
 */
export function rollupSessionAnalysis(answers: RollupAnswer[]): SessionRollup {
  // A null analysisStatus predates Spec 2a's migration entirely — it is not
  // "attempted and failed," so it is excluded from totalCount, not just from
  // analyzedCount. Counting it would overstate how much of a real, post-spec
  // session went unanalyzed.
  const counted = answers.filter((a) => a.analysisStatus !== null)
  const analyzed = counted.filter((a) => a.analysisStatus === 'analyzed')

  const errorsByDimension: Record<Dimension, number> = {
    accuracy: 0,
    clarity: 0,
    conciseness: 0,
  }
  const typeCounts = new Map<string, { dimension: Dimension; count: number; significance: number }>()
  const klpStruggles = new Map<string, { failCount: number; totalSignificance: number }>()

  for (const a of analyzed) {
    for (const tag of a.errorTags) {
      errorsByDimension[tag.dimension]++
      const entry = typeCounts.get(tag.type) ?? { dimension: tag.dimension, count: 0, significance: 0 }
      entry.count++
      entry.significance += tag.significance
      typeCounts.set(tag.type, entry)

      if (tag.klpId) {
        const s = klpStruggles.get(tag.klpId) ?? { failCount: 0, totalSignificance: 0 }
        s.totalSignificance += tag.significance
        klpStruggles.set(tag.klpId, s)
      }
    }

    for (const r of a.klpResults) {
      if (r.status !== 'failed') continue
      const s = klpStruggles.get(r.klpId) ?? { failCount: 0, totalSignificance: 0 }
      s.failCount++
      klpStruggles.set(r.klpId, s)
    }
  }

  const errorsByType = [...typeCounts.entries()]
    .map(([type, v]) => ({ type, dimension: v.dimension, count: v.count, _sig: v.significance }))
    .sort((a, b) => b.count - a.count || b._sig - a._sig)
    .map(({ type, dimension, count }) => ({ type, dimension, count }))

  const struggledKlps = [...klpStruggles.entries()]
    .filter(([, v]) => v.failCount > 0)
    .map(([klpId, v]) => ({ klpId, failCount: v.failCount, totalSignificance: v.totalSignificance }))
    .sort((a, b) => b.failCount - a.failCount || b.totalSignificance - a.totalSignificance)
    .slice(0, MAX_STRUGGLED_KLPS)

  return {
    analyzedCount: analyzed.length,
    totalCount: counted.length,
    errorsByDimension,
    errorsByType,
    struggledKlps,
  }
}
