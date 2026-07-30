import type { StudySource } from './scoring'

/** Bucket name for cards carrying no category, kept explicit in the output. */
export const UNCATEGORIZED_LABEL = 'Uncategorized'

/**
 * One recorded interaction, flattened for summarization. The caller joins the
 * StudyEvent rows to card terms and category names; this module stays pure so
 * every branch is testable without a database.
 */
export interface SessionItem {
  cardId: string
  term: string
  source: StudySource
  correct: boolean | null
  /** 0-100 for graded (short-answer) items, null otherwise. */
  score: number | null
  confidenceBefore: number | null
  confidenceAfter: number
  /** Already normalized; null means "not measured", never "instant". */
  latencyMs: number | null
  categoryNames: string[]
}

export interface CategoryStat {
  name: string
  correct: number
  total: number
  accuracyPct: number
}

export interface ModeStat {
  mode: StudySource
  correct: number
  total: number
  avgScore: number | null
  medianLatencyMs: number | null
}

export interface TimedItem {
  cardId: string
  term: string
  latencyMs: number
}

export interface SessionComputed {
  itemCount: number
  byCategory: CategoryStat[]
  byMode: ModeStat[]
  pacing: {
    medianLatencyMs: number | null
    fastest: TimedItem | null
    slowest: TimedItem | null
    byMode: { mode: StudySource; medianLatencyMs: number | null }[]
  }
}

/** Median of a numeric series. Returns null for an empty series. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function timed(items: SessionItem[]): TimedItem[] {
  return items
    .filter((i): i is SessionItem & { latencyMs: number } => i.latencyMs !== null)
    .map((i) => ({ cardId: i.cardId, term: i.term, latencyMs: i.latencyMs }))
}

/**
 * Deterministic breakdown of one study session. Zero cost, always present, and
 * the sole source of every number in a SessionInsight — the AI layer reads
 * this and writes prose, it never computes a figure of its own.
 */
export function summarizeSession(items: SessionItem[]): SessionComputed {
  const byCategory = new Map<string, { correct: number; total: number }>()
  for (const i of items) {
    const names = i.categoryNames.length > 0 ? i.categoryNames : [UNCATEGORIZED_LABEL]
    for (const name of names) {
      const bucket = byCategory.get(name) ?? { correct: 0, total: 0 }
      bucket.total += 1
      if (i.correct === true) bucket.correct += 1
      byCategory.set(name, bucket)
    }
  }

  const byMode = new Map<StudySource, SessionItem[]>()
  for (const i of items) {
    const bucket = byMode.get(i.source) ?? []
    bucket.push(i)
    byMode.set(i.source, bucket)
  }

  const allTimed = timed(items)
  const latencies = allTimed.map((t) => t.latencyMs)

  const modeStats: ModeStat[] = Array.from(byMode.entries())
    .map(([mode, group]) => {
      const scores = group
        .map((g) => g.score)
        .filter((s): s is number => typeof s === 'number')
      return {
        mode,
        correct: group.filter((g) => g.correct === true).length,
        total: group.length,
        avgScore:
          scores.length > 0
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : null,
        medianLatencyMs: median(timed(group).map((t) => t.latencyMs)),
      }
    })
    .sort((a, b) => a.mode.localeCompare(b.mode))

  return {
    itemCount: items.length,
    byCategory: Array.from(byCategory.entries())
      .map(([name, { correct, total }]) => ({
        name,
        correct,
        total,
        accuracyPct: Math.round((correct / total) * 100),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    byMode: modeStats,
    pacing: {
      medianLatencyMs: median(latencies),
      fastest:
        allTimed.length > 0
          ? allTimed.reduce((min, t) => (t.latencyMs < min.latencyMs ? t : min))
          : null,
      slowest:
        allTimed.length > 0
          ? allTimed.reduce((max, t) => (t.latencyMs > max.latencyMs ? t : max))
          : null,
      byMode: modeStats.map((m) => ({ mode: m.mode, medianLatencyMs: m.medianLatencyMs })),
    },
  }
}
