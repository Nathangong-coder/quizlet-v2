import { describe, it, expect } from 'vitest'
import { buildForgettingCurve, toRecallPairs, MIN_GAP_PAIRS } from '@/lib/metrics/forgetting'
import type { RecallPair } from '@/lib/metrics/forgetting'

const pair = (gapDays: number, recalled: boolean): RecallPair => ({ gapDays, recalled })

describe('insufficient data', () => {
  it('returns null below the pair floor rather than a curve from noise', () => {
    const pairs = Array.from({ length: MIN_GAP_PAIRS - 1 }, () => pair(1, true))
    expect(buildForgettingCurve(pairs)).toBeNull()
  })
})

describe('bucketing', () => {
  it('reports recall per bucket and omits buckets with no observations', () => {
    const pairs = [
      pair(0.5, true), pair(0.5, true), pair(0.5, false),
      pair(2, true), pair(2, false),
      pair(6, false),
    ]
    const curve = buildForgettingCurve(pairs)!
    const under1d = curve.buckets.find((b) => b.label === '<1d')!
    expect(under1d.total).toBe(3)
    expect(under1d.recallRate).toBeCloseTo(2 / 3, 5)
    expect(curve.buckets.find((b) => b.label === '7-30d')).toBeUndefined()
  })

  it('respects bucket boundaries exactly', () => {
    const pairs = [
      pair(0.99, true), pair(0.99, true), pair(0.99, true),
      pair(1, true), pair(1, true),
      pair(2.9, true), pair(2.9, false),
    ]
    const curve = buildForgettingCurve(pairs)!
    const under1d = curve.buckets.find((b) => b.label === '<1d')!
    const oneToThree = curve.buckets.find((b) => b.label === '1-3d')!
    expect(under1d.total).toBe(3)
    expect(oneToThree.total).toBe(4)
    expect(curve.buckets.find((b) => b.label === '3-7d')).toBeUndefined()
  })
})

describe('half life', () => {
  it('interpolates where recall crosses 0.5', () => {
    const pairs = [
      pair(0.5, true), pair(0.5, true), pair(0.5, true), pair(0.5, true),
      pair(2, true), pair(2, false),
      pair(5, false), pair(5, false),
    ]
    const curve = buildForgettingCurve(pairs)!
    expect(curve.halfLifeDays).not.toBeNull()
    expect(curve.halfLifeDays!).toBeGreaterThan(0)
  })

  it('interpolates correctly between bucket centers', () => {
    const pairs = [
      pair(0.5, true), pair(0.5, true), pair(0.5, true),
      pair(1.5, true), pair(1.5, true), pair(1.5, true),
      pair(4, false), pair(4, false), pair(4, false),
    ]
    const curve = buildForgettingCurve(pairs)!
    expect(curve.halfLifeDays).not.toBeNull()
    // prev bucket: 1-3d with center ~2, recallRate=1.0
    // curr bucket: 3-7d with center ~5, recallRate=0.0
    // t = (1.0 - 0.5) / (1.0 - 0.0) = 0.5
    // halfLife = 2 + 0.5 * (5 - 2) = 3.5
    expect(curve.halfLifeDays!).toBeCloseTo(3.5, 1)
  })

  it('returns null half life when recall never falls to 0.5', () => {
    const pairs = [
      pair(0.5, true), pair(0.5, true),
      pair(2, true), pair(2, true),
      pair(10, true), pair(40, true),
    ]
    const curve = buildForgettingCurve(pairs)!
    expect(curve.halfLifeDays).toBeNull()
  })
})

describe('toRecallPairs', () => {
  const NOW = new Date('2026-08-05T12:00:00.000Z')
  const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

  it('pairs consecutive events on the same card and measures the gap in days', () => {
    const pairs = toRecallPairs([
      { cardId: 'c1', correct: true, createdAt: at(5) },
      { cardId: 'c1', correct: false, createdAt: at(3) },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].gapDays).toBeCloseTo(2, 5)
    expect(pairs[0].recalled).toBe(false)
  })

  it('never pairs across different cards', () => {
    const pairs = toRecallPairs([
      { cardId: 'c1', correct: true, createdAt: at(5) },
      { cardId: 'c2', correct: true, createdAt: at(3) },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('skips events with unknown correctness rather than guessing', () => {
    const pairs = toRecallPairs([
      { cardId: 'c1', correct: true, createdAt: at(5) },
      { cardId: 'c1', correct: null, createdAt: at(3) },
    ])
    expect(pairs).toHaveLength(0)
  })
})
