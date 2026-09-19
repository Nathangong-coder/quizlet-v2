import { describe, it, expect } from 'vitest'
import { reviewOutcome, describeDispute, foldReview } from '@/lib/analysis/benchmark-review'
import { GRADER_PANEL_BANDS, bandHit } from '@/lib/analysis/benchmark'

describe('reviewOutcome', () => {
  it('agree when every point is accepted; strong when any is held firmly; disagree otherwise; empty is disagree', () => {
    expect(reviewOutcome([{ stance: 'accept', firm: true }, { stance: 'accept', firm: false }])).toBe('agree')
    expect(reviewOutcome([{ stance: 'accept', firm: true }, { stance: 'hold', firm: true }])).toBe('strong')
    expect(reviewOutcome([{ stance: 'hold', firm: false }])).toBe('disagree')
    expect(reviewOutcome([])).toBe('disagree')
  })
})

describe('describeDispute', () => {
  it('bands: a band miss is a dispute, a hit is not', () => {
    expect(describeDispute({ kind: 'bands', level: 'good', intendedRank: 3, score: 0.85, siblings: [] })).toBeNull()
    expect(describeDispute({ kind: 'blind-bands', level: 'good', intendedRank: 3, score: 0.62, siblings: [] })).toMatch(/62\/100 .*"good" \(80-89\)/)
  })
  it('levels: a rank inversion is a dispute, a clean order is not', () => {
    const sib = [{ intendedRank: 1, score: 1 }, { intendedRank: 2, score: 0.8 }, { intendedRank: 3, score: 0.5 }, { intendedRank: 4, score: 0.2 }]
    expect(describeDispute({ kind: 'levels', level: 'competent', intendedRank: 2, score: 0.8, siblings: sib })).toBeNull()
    const tie = [{ intendedRank: 1, score: 1 }, { intendedRank: 2, score: 1 }]
    expect(describeDispute({ kind: 'blind', level: 'competent', intendedRank: 2, score: 1, siblings: tie })).toMatch(/ranked ABOVE it scored 100/)
  })
  it('every band is hit by its own bounds and missed just outside them', () => {
    for (const b of GRADER_PANEL_BANDS) {
      expect(bandHit(b.id, b.low / 100)).toBe(true)
      expect(bandHit(b.id, b.high / 100)).toBe(true)
      if (b.high < 100) expect(bandHit(b.id, (b.high + 1) / 100)).toBe(false)
    }
  })
})

describe('foldReview', () => {
  it('carries the isolated verdict as before, the accepted one as after, drops an unresolvable ref', () => {
    const f = foldReview(
      {
        points: [
          { klpRef: 0, stance: 'accept', verdict: 'incomplete', firm: false, reason: 'r' },
          { klpRef: 1, stance: 'hold', verdict: 'correct', firm: true, reason: 'r' },
          { klpRef: 9, stance: 'accept', verdict: 'omission', firm: true, reason: 'r' },
        ],
        summary: 's',
      },
      ['k0', 'k1'],
      [{ klpRef: 0, status: 'correct' }, { klpRef: 1, status: 'correct' }],
    )
    expect(f.points).toEqual([
      { klpRef: 0, klpId: 'k0', stance: 'accept', before: 'correct', after: 'incomplete', firm: false, reason: 'r' },
      { klpRef: 1, klpId: 'k1', stance: 'hold', before: 'correct', after: 'correct', firm: true, reason: 'r' },
    ])
    expect(f.dropped).toBe(1)
    expect(f.outcome).toBe('strong')
  })
})
