/**
 * Pure scoring functions for the unified study-memory write path (Stage 6).
 *
 * Every study mode (Review, Quiz MC/SA/TF, Matching, future Lessons) funnels
 * through `recordStudyEvent` (src/lib/memory/record.ts), which delegates the
 * actual math to these two pure functions so the rules stay in one place and
 * are trivially unit-testable without touching the database.
 */

/** Every mode that can currently write to study memory. */
export type StudySource =
  | 'review'
  | 'quiz-mc'
  | 'quiz-sa'
  | 'quiz-tf'
  | 'matching'
  | 'lesson'

/**
 * The result of a single study interaction.
 * - `{ correct }` — binary right/wrong modes: Review, MC, TF, Matching.
 * - `{ overall }` — graded modes: short-answer AI grading, on the existing
 *   app-wide 1-10 rubric scale (see `ShortAnswerGradeSchema.overall` in
 *   src/lib/ai/schemas.ts and the `grade.overall * 10` convention already
 *   used in src/actions/quiz.ts).
 */
export type StudyOutcome = { correct: boolean } | { overall: number }

const CONFIDENCE_MIN = 1
const CONFIDENCE_MAX = 10

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * Confidence delta rules:
 * - Binary outcomes (review/MC/TF/matching): +1 correct, -1 wrong — this is
 *   the exact ±1 rule `recordReview` already uses today.
 * - Graded outcomes (short-answer `overall`, 1-10 scale):
 *     >= 8  -> +1  (clearly correct)
 *     7     ->  0  (borderline/partial credit — no signal either way)
 *     5-6   -> -1  (mediocre — leans toward not knowing it)
 *     <= 4  -> -2  (clearly wrong — penalized harder than a flat miss,
 *                   since a graded low score reflects a worse miss than a
 *                   simple binary "wrong")
 */
export function nextConfidence(old: number, outcome: StudyOutcome): number {
  const delta =
    'correct' in outcome
      ? outcome.correct
        ? 1
        : -1
      : gradedDelta(outcome.overall)

  return clamp(old + delta, CONFIDENCE_MIN, CONFIDENCE_MAX)
}

function gradedDelta(overall: number): number {
  if (overall >= 8) return 1
  if (overall <= 4) return -2
  if (overall <= 6) return -1
  return 0 // overall === 7 (or any other borderline value, e.g. non-integer)
}

/** The minimal shape `masteryScore` needs from a StudyEvent-like row. */
export interface MasteryEvent {
  /** Set on every event: binary right/wrong. For graded rows this is the
   *  thresholded `overall >= 8`, so `score` (when present) is more precise. */
  correct?: boolean | null
  /** Set for graded modes (short-answer), 0-100 scale. */
  score?: number | null
  createdAt: Date
}

/** How many of the most recent events feed into the mastery calculation. */
const MASTERY_WINDOW = 10
/** Exponential recency decay applied per step back from the most recent event. */
const MASTERY_DECAY = 0.8

/**
 * Maps a StudyEvent-like row to a 0-1 correctness signal, or `null` if the
 * event carries no usable signal at all. Exported so other pure modules
 * (e.g. `lib/memory/profile.ts`'s trend/miss classification) can reuse the
 * exact same "what counts as right/wrong" rule as `masteryScore` instead of
 * re-deriving it.
 *
 * `score` wins over `correct` because `recordStudyEvent` writes *both* for
 * graded answers, deriving `correct` as `overall >= 8`. Reading `correct`
 * first would throw the graded nuance away — an answer scoring 79 would count
 * as an outright miss and 80 as flawless, collapsing the whole short-answer
 * rubric into a step function.
 */
export function eventCorrectness(event: MasteryEvent): number | null {
  if (typeof event.score === 'number') return clamp(event.score, 0, 100) / 100
  if (typeof event.correct === 'boolean') return event.correct ? 1 : 0
  return null
}

/**
 * Recency-weighted correctness over the most recent `MASTERY_WINDOW` events,
 * as a 0-100 integer. Returns `null` when there is no scorable event (empty
 * history, or every event lacks both `correct` and `score`).
 *
 * Events are sorted by `createdAt` descending (input order doesn't matter),
 * then the most recent `MASTERY_WINDOW` are weighted with exponential decay
 * (`MASTERY_DECAY ** i`, i = 0 for the most recent) so a recent miss pulls
 * the score down more than an equally-old one, and events older than the
 * window have zero influence.
 */
export function masteryScore(events: MasteryEvent[]): number | null {
  const recent = [...events]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MASTERY_WINDOW)

  let weightedSum = 0
  let weightTotal = 0

  recent.forEach((event, i) => {
    const correctness = eventCorrectness(event)
    if (correctness === null) return
    const weight = Math.pow(MASTERY_DECAY, i)
    weightedSum += weight * correctness
    weightTotal += weight
  })

  if (weightTotal === 0) return null
  return Math.round((weightedSum / weightTotal) * 100)
}

/** The four buckets the Cards ledger and the Breakdown counts share. */
export type MasteryBucket = 'mastered' | 'solid' | 'shaky' | 'struggling'

export const MASTERED_MIN_MASTERY = 80
export const MASTERED_MIN_CONFIDENCE = 8
const SOLID_MIN_MASTERY = 60
const SOLID_MIN_CONFIDENCE = 7
const SHAKY_MIN_CONFIDENCE = 4

/**
 * Buckets a card's progress. One definition backs the distribution bar, the
 * bucket lists, and every "mastered" count in the app — previously each caller
 * inlined its own `confidence >= 8` rule.
 *
 * `mastery` is nullable (rows written before Stage 6 Task 4, or never scored)
 * and each rule must fall through on null rather than coercing it to 0: a card
 * with confidence 9 and no mastery score is Solid, not Struggling.
 */
export function masteryBucket({
  confidence,
  mastery,
}: {
  confidence: number
  mastery?: number | null
}): MasteryBucket {
  const scored = typeof mastery === 'number' ? mastery : null

  if (scored !== null && scored >= MASTERED_MIN_MASTERY && confidence >= MASTERED_MIN_CONFIDENCE) {
    return 'mastered'
  }
  if ((scored !== null && scored >= SOLID_MIN_MASTERY) || confidence >= SOLID_MIN_CONFIDENCE) {
    return 'solid'
  }
  if (confidence >= SHAKY_MIN_CONFIDENCE) return 'shaky'
  return 'struggling'
}
