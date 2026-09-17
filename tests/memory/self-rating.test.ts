import { describe, it, expect } from 'vitest'
import {
  SELF_RATINGS,
  SELF_RATING_LABELS,
  SELF_RATING_MOMENTS,
  isSelfRating,
  isSelfRatingMoment,
} from '@/lib/memory/self-rating'

describe('self-rating vocabulary', () => {
  it('is exactly 1..4 with a label each', () => {
    expect(SELF_RATINGS).toEqual([1, 2, 3, 4])
    for (const r of SELF_RATINGS) expect(SELF_RATING_LABELS[r].length).toBeGreaterThan(0)
  })

  it('isSelfRating rejects 0, 5, 2.5 and strings', () => {
    for (const bad of [0, 5, 2.5, '3', null, undefined, NaN, -1]) {
      expect(isSelfRating(bad)).toBe(false)
    }
    for (const good of SELF_RATINGS) expect(isSelfRating(good)).toBe(true)
  })

  it('isSelfRatingMoment accepts only the two persisted moments', () => {
    expect(SELF_RATING_MOMENTS).toEqual(['before_answer', 'after_answer'])
    expect(isSelfRatingMoment('before_answer')).toBe(true)
    expect(isSelfRatingMoment('after_answer')).toBe(true)
    expect(isSelfRatingMoment('after')).toBe(false)
    expect(isSelfRatingMoment(1)).toBe(false)
    expect(isSelfRatingMoment(null)).toBe(false)
  })
})
