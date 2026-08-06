/** Splitting fewer items into thirds measures noise, not fatigue. */
export const MIN_ITEMS_FOR_SHAPE = 6

/** Accuracy must fall at least this far for the session to count as fatigued. */
const FATIGUE_ACCURACY_DROP = 0.15
/** ...and latency must rise by at least this factor. */
const FATIGUE_LATENCY_RATIO = 1.2

export interface ShapeItem {
  correct: boolean
  latencyMs: number
}

export interface SessionShape {
  itemsPerMinute: number | null
  /** Last third's accuracy minus the first third's. Negative means decline. */
  accuracyDelta: number
  /** Last third's mean latency over the first third's. Above 1 means slowing. */
  latencyRatio: number
  fatigued: boolean
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Velocity and fatigue over one session, in the order items were answered.
 */
export function sessionShape(items: ShapeItem[], durationMs: number): SessionShape | null {
  if (items.length < MIN_ITEMS_FOR_SHAPE) return null

  const third = Math.floor(items.length / 3)
  const first = items.slice(0, third)
  const last = items.slice(items.length - third)

  const accuracyDelta =
    mean(last.map((i) => (i.correct ? 1 : 0))) - mean(first.map((i) => (i.correct ? 1 : 0)))

  const firstLatency = mean(first.map((i) => i.latencyMs))
  const latencyRatio = firstLatency === 0 ? 1 : mean(last.map((i) => i.latencyMs)) / firstLatency

  return {
    itemsPerMinute: durationMs > 0 ? items.length / (durationMs / 60_000) : null,
    accuracyDelta,
    latencyRatio,
    fatigued: accuracyDelta <= -FATIGUE_ACCURACY_DROP && latencyRatio >= FATIGUE_LATENCY_RATIO,
  }
}
