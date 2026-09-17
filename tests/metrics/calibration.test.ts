import { describe, it, expect } from 'vitest'
import {
  CALIBRATION_MIN_SAMPLE,
  bucketCalibration,
  calibrationSample,
} from '@/lib/metrics/calibration'

// Spec 6 §6: counts, never a score. NULL ratings are absence of measurement
// and are excluded before anything else; `score >= 80` beats the boolean; a
// row with neither is excluded, never counted as wrong.
describe('bucketCalibration', () => {
  it('excludes NULL ratings, prefers score over correct, excludes rows with neither', () => {
    const b = bucketCalibration([
      { selfRating: null, correct: true, score: 100 },
      { selfRating: 4, correct: false, score: 90 }, // score wins -> correct
      { selfRating: 4, correct: true, score: null }, // boolean
      { selfRating: 2, correct: null, score: null }, // excluded
    ])
    expect(b.find((x) => x.rating === 4)).toEqual({ rating: 4, n: 2, correct: 2 })
    expect(b.find((x) => x.rating === 2)).toEqual({ rating: 2, n: 0, correct: 0 })
    expect(calibrationSample(b)).toBe(2)
  })

  it('always returns four buckets in order', () => {
    expect(bucketCalibration([]).map((b) => b.rating)).toEqual([1, 2, 3, 4])
    expect(bucketCalibration([]).every((b) => b.n === 0 && b.correct === 0)).toBe(true)
  })

  it('score below 80 is wrong even when correct is true (the overall >= 8 convention)', () => {
    const b = bucketCalibration([{ selfRating: 3, correct: true, score: 79 }])
    expect(b.find((x) => x.rating === 3)).toEqual({ rating: 3, n: 1, correct: 0 })
    expect(bucketCalibration([{ selfRating: 3, correct: false, score: 80 }]).find((x) => x.rating === 3))
      .toEqual({ rating: 3, n: 1, correct: 1 })
  })

  it('drops an out-of-vocabulary rating rather than inventing a bucket', () => {
    const b = bucketCalibration([
      { selfRating: 7, correct: true, score: null },
      { selfRating: 0, correct: true, score: null },
      { selfRating: 1, correct: false, score: null },
    ])
    expect(b).toHaveLength(4)
    expect(calibrationSample(b)).toBe(1)
    expect(b[0]).toEqual({ rating: 1, n: 1, correct: 0 })
  })

  it('buckets sum to the sample', () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({
      selfRating: ((i % 4) + 1) as number,
      correct: i % 3 === 0,
      score: null,
    }))
    const b = bucketCalibration(rows)
    expect(b.reduce((s, x) => s + x.n, 0)).toBe(23)
    expect(calibrationSample(b)).toBe(23)
    expect(b.every((x) => x.correct <= x.n)).toBe(true)
  })

  it('the floor is 20', () => {
    expect(CALIBRATION_MIN_SAMPLE).toBe(20)
  })
})
