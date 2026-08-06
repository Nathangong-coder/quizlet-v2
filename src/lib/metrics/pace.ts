import type { StudySource } from '@/lib/memory/scoring'

/** Below this many timed answers on a card, no ratio is reported. */
export const MIN_TIMED_OBSERVATIONS = 3

export interface TimedEvent {
  cardId: string
  mode: StudySource
  latencyMs: number
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * A card's median response time over the learner's own median IN THAT MODE.
 *
 * Mode-scoped because short answer and true/false differ by an order of
 * magnitude — a cross-mode ratio measures the mode, not the card. `> 1` is
 * effortful retrieval, `< 1` fluent. This is what separates "correct" from
 * "actually known": a card answered right at 2.4x baseline is not mastered.
 */
export function paceIndex(
  events: TimedEvent[],
  cardId: string,
  mode: StudySource,
): number | null {
  const inMode = events.filter((e) => e.mode === mode)
  const cardTimes = inMode.filter((e) => e.cardId === cardId).map((e) => e.latencyMs)
  if (cardTimes.length < MIN_TIMED_OBSERVATIONS) return null

  const cardMedian = medianOf(cardTimes)
  const baseline = medianOf(inMode.map((e) => e.latencyMs))
  if (cardMedian === null || baseline === null || baseline === 0) return null

  return cardMedian / baseline
}
