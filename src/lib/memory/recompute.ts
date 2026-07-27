/**
 * Pure replay logic for recomputing a card's CardProgress after one or more
 * of its StudyEvent rows have been deleted (src/actions/memory.ts's
 * `deleteStudyEvent`). Reuses the exact same pure functions the live write
 * path (`recordStudyEvent`, src/lib/memory/record.ts) already trusts —
 * `nextConfidence`/`masteryScore` (scoring.ts) and `nextDueAt` (schedule.ts)
 * — so a recompute produces the same state as if the remaining events had
 * been the only ones ever applied, incrementally, in order.
 */
import { nextConfidence, masteryScore } from './scoring'
import type { StudyOutcome, MasteryEvent } from './scoring'
import { nextDueAt } from './schedule'

const DEFAULT_CONFIDENCE = 5

/** The minimal StudyEvent shape this replay needs. */
export interface RecomputeEvent {
  correct: boolean | null
  score: number | null
  createdAt: Date
}

export interface RecomputedCardProgress {
  confidence: number
  mastery: number | null
  reps: number
  dueAt: Date
  lastSeenAt: Date
}

/**
 * `score` is on the 0-100 scale record.ts writes (`Math.round(overall * 10)`
 * for graded short-answer outcomes); `nextConfidence` expects `overall` back
 * on the original 1-10 rubric scale, so this divides by 10 to invert that.
 */
function toOutcome(event: RecomputeEvent): StudyOutcome {
  if (event.score !== null) return { overall: event.score / 10 }
  return { correct: !!event.correct }
}

/**
 * Replays `remainingEvents` (any order) in chronological order from the same
 * defaults `recordStudyEvent` uses for a fresh card (confidence 5, reps 0),
 * returning the resulting CardProgress state. Returns `null` when the list is
 * empty, signaling the caller to delete the CardProgress row entirely rather
 * than upsert a stale one (the card reverts to "never studied").
 */
export function recomputeCardProgress(
  remainingEvents: RecomputeEvent[],
): RecomputedCardProgress | null {
  if (remainingEvents.length === 0) return null

  const chronological = [...remainingEvents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  let confidence = DEFAULT_CONFIDENCE
  let reps = 0
  let dueAt = chronological[0].createdAt
  let lastSeenAt = chronological[0].createdAt

  for (const event of chronological) {
    confidence = nextConfidence(confidence, toOutcome(event))
    const correct = !!event.correct
    reps = correct ? reps + 1 : 0
    lastSeenAt = event.createdAt
    dueAt = nextDueAt({ correct, confidence, reps, now: lastSeenAt })
  }

  const masteryEvents: MasteryEvent[] = remainingEvents.map((e) => ({
    correct: e.correct,
    score: e.score,
    createdAt: e.createdAt,
  }))

  return { confidence, mastery: masteryScore(masteryEvents), reps, dueAt, lastSeenAt }
}
