/** Below this many consecutive same-card pairs, no curve is reported. */
export const MIN_GAP_PAIRS = 5

export const GAP_BUCKETS = [
  { label: '<1d', maxDays: 1 },
  { label: '1-3d', maxDays: 3 },
  { label: '3-7d', maxDays: 7 },
  { label: '7-30d', maxDays: 30 },
  { label: '>30d', maxDays: Infinity },
] as const

export interface RecallPair {
  gapDays: number
  recalled: boolean
}

/** A scorable study event, for deriving gap pairs. */
export interface GapEvent {
  cardId: string
  correct: boolean | null
  createdAt: Date
}

/**
 * Turn a flat event log into consecutive same-card pairs: "they saw this N days
 * after last time — did they still have it?"
 *
 * Pure so the read shell stays a shell. Events with unknown correctness are
 * skipped rather than assumed, which also breaks the chain around them — a gap
 * spanning an unscored event is not a measured retention interval.
 */
export function toRecallPairs(events: GapEvent[]): RecallPair[] {
  const byCard = new Map<string, GapEvent[]>()
  for (const e of events) {
    if (e.correct === null) continue
    const list = byCard.get(e.cardId)
    if (list) list.push(e)
    else byCard.set(e.cardId, [e])
  }

  const pairs: RecallPair[] = []
  for (const list of byCard.values()) {
    const chronological = [...list].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
    for (let i = 1; i < chronological.length; i++) {
      const gapMs = chronological[i].createdAt.getTime() - chronological[i - 1].createdAt.getTime()
      pairs.push({
        gapDays: gapMs / 86_400_000,
        recalled: chronological[i].correct === true,
      })
    }
  }
  return pairs
}

export interface ForgettingBucket {
  label: string
  /** Bucket midpoint in days, used for half-life interpolation. */
  centerDays: number
  recallRate: number
  total: number
}

export interface ForgettingCurve {
  buckets: ForgettingBucket[]
  halfLifeDays: number | null
}

function bucketFor(gapDays: number): (typeof GAP_BUCKETS)[number] {
  return GAP_BUCKETS.find((b) => gapDays < b.maxDays) ?? GAP_BUCKETS[GAP_BUCKETS.length - 1]
}

function centerOf(index: number): number {
  const lower = index === 0 ? 0 : GAP_BUCKETS[index - 1].maxDays
  const upper = GAP_BUCKETS[index].maxDays
  return upper === Infinity ? lower * 2 : (lower + upper) / 2
}

/**
 * An EMPIRICAL curve, deliberately not a fitted exponential. An optimizer over
 * a handful of sparse pairs returns a decay constant to three decimals the data
 * cannot support; buckets state only what was actually observed.
 */
export function buildForgettingCurve(pairs: RecallPair[]): ForgettingCurve | null {
  if (pairs.length < MIN_GAP_PAIRS) return null

  const buckets: ForgettingBucket[] = []
  GAP_BUCKETS.forEach((spec, i) => {
    const inBucket = pairs.filter((p) => bucketFor(p.gapDays).label === spec.label)
    if (inBucket.length === 0) return
    buckets.push({
      label: spec.label,
      centerDays: centerOf(i),
      recallRate: inBucket.filter((p) => p.recalled).length / inBucket.length,
      total: inBucket.length,
    })
  })

  return { buckets, halfLifeDays: interpolateHalfLife(buckets) }
}

/** Linear interpolation at the first 0.5 crossing. Null if it never crosses. */
function interpolateHalfLife(buckets: ForgettingBucket[]): number | null {
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1]
    const curr = buckets[i]
    if (prev.recallRate >= 0.5 && curr.recallRate < 0.5) {
      const span = prev.recallRate - curr.recallRate
      if (span === 0) return curr.centerDays
      const t = (prev.recallRate - 0.5) / span
      return prev.centerDays + t * (curr.centerDays - prev.centerDays)
    }
  }
  return null
}
