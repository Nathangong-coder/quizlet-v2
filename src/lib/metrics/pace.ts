import type { StudySource } from '@/lib/memory/scoring'

/** Below this many timed answers on a card, no ratio is reported. */
export const MIN_TIMED_OBSERVATIONS = 3

export interface TimedEvent {
  cardId: string
  mode: StudySource
  latencyMs: number
  /** Optional so existing callers that never populated it stay valid. */
  correct?: boolean | null
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

/**
 * Below this pace index, retrieval is not slow enough to be worth surfacing
 * as its own finding — it's within normal variance of the learner's own
 * baseline for the mode.
 */
export const PACE_OUTLIER_MIN_INDEX = 1.5

/**
 * Cards the learner answers correctly but effortfully: `paceIndex` at or
 * above `minIndex`, restricted to cards whose timed answers in `mode` were
 * majority-correct.
 *
 * The majority-correct filter is the point of the metric, not an incidental
 * restriction. This surfaces "correct but not fluent" — a real, distinct
 * finding from "doesn't know it." A card answered slowly AND wrongly is
 * already captured by the knowledge estimate (mastery/pKnown); counting it
 * here too would double-count the same weakness under a different label and
 * drown out the actual fluency signal this metric exists to isolate.
 *
 * "Majority" compares explicit `correct: true` vs `correct: false` counts
 * among the card's timed events in `mode` — events with `correct` unset or
 * null count toward neither side, so a card with no correctness evidence at
 * all is excluded (a tie, not a majority) rather than assumed correct.
 *
 * Cards below `MIN_TIMED_OBSERVATIONS` are excluded automatically: their
 * `paceIndex` is already null, which never clears `minIndex`.
 *
 * Sorted by index descending — the most effortful cards first.
 */
export function paceOutliers(
  events: TimedEvent[],
  mode: StudySource,
  minIndex: number = PACE_OUTLIER_MIN_INDEX,
): { cardId: string; index: number }[] {
  const inMode = events.filter((e) => e.mode === mode)
  const cardIds = [...new Set(inMode.map((e) => e.cardId))]

  const outliers: { cardId: string; index: number }[] = []
  for (const cardId of cardIds) {
    const index = paceIndex(events, cardId, mode)
    if (index === null || index < minIndex) continue

    const cardEvents = inMode.filter((e) => e.cardId === cardId)
    const correctCount = cardEvents.filter((e) => e.correct === true).length
    const incorrectCount = cardEvents.filter((e) => e.correct === false).length
    if (correctCount <= incorrectCount) continue

    outliers.push({ cardId, index })
  }

  return outliers.sort((a, b) => b.index - a.index)
}
