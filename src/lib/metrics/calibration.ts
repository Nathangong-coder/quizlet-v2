import { SELF_RATINGS, isSelfRating, type SelfRating } from '@/lib/memory/self-rating'

/**
 * Spec 6 §6: the proof-of-capture readout. COUNTS, never a score.
 *
 * ECE, Brier, the probability mapping and any use in mastery are Spec 7's.
 * This module only pairs each rated answer with its outcome and counts, so
 * the owner can watch the capture land. The floor exists for the histogram
 * reason: a tile that fires on a first session's four ratings is a tile that
 * gets ignored.
 */
export const CALIBRATION_MIN_SAMPLE = 20

export interface CalibrationBucket {
  rating: SelfRating
  /** Rated answers with an outcome to compare against. */
  n: number
  /** Of those, how many were right. */
  correct: number
}

export interface CalibrationRow {
  selfRating: number | null
  correct: boolean | null
  score: number | null
}

/**
 * Right or wrong for one row. `score >= 80` when a score is present (the
 * `overall >= 8` convention `recordStudyEvent` itself derives `correct` from),
 * else the boolean. NULL when the row carries neither — such a row is
 * EXCLUDED by the caller, never counted as wrong: a Review "I knew it" with no
 * graded outcome is not a miss.
 */
function rowCorrect(row: CalibrationRow): boolean | null {
  if (typeof row.score === 'number') return row.score >= 80
  if (typeof row.correct === 'boolean') return row.correct
  return null
}

/**
 * Four buckets, always, in rating order 1..4 — an empty bucket is a real
 * count of zero, not an absent row. Rows with a NULL rating are excluded
 * before anything else (absence of measurement, D4/§7), and a rating outside
 * the vocabulary is dropped rather than given a bucket of its own.
 */
export function bucketCalibration(rows: CalibrationRow[]): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = SELF_RATINGS.map((rating) => ({ rating, n: 0, correct: 0 }))
  for (const row of rows) {
    if (!isSelfRating(row.selfRating)) continue
    const correct = rowCorrect(row)
    if (correct === null) continue
    const bucket = buckets[row.selfRating - 1]
    bucket.n += 1
    if (correct) bucket.correct += 1
  }
  return buckets
}

/** The number of rated answers behind the buckets — what the floor reads. */
export function calibrationSample(buckets: CalibrationBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.n, 0)
}
