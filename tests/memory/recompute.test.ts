import { describe, it, expect } from 'vitest'
import { recomputeCardProgress } from '@/lib/memory/recompute'
import { masteryScore } from '@/lib/memory/scoring'
import type { RecomputeEvent } from '@/lib/memory/recompute'

const t1 = new Date('2026-07-20T00:00:00.000Z')
const t2 = new Date('2026-07-22T00:00:00.000Z')
const t3 = new Date('2026-07-24T00:00:00.000Z')

describe('recomputeCardProgress', () => {
  it('returns null when no events remain (card should revert to unseen)', () => {
    expect(recomputeCardProgress([])).toBeNull()
  })

  it('replays a single correct binary event from the default baseline (confidence 5, reps 0)', () => {
    const events: RecomputeEvent[] = [
      { correct: true, score: null, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(6) // 5 + 1 (correct binary delta)
    expect(result!.reps).toBe(1)
    expect(result!.lastSeenAt.getTime()).toBe(t1.getTime())
    expect(result!.mastery).toBe(masteryScore(events))
  })

  it('replays a single incorrect binary event', () => {
    const events: RecomputeEvent[] = [
      { correct: false, score: null, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result!.confidence).toBe(4) // 5 - 1
    expect(result!.reps).toBe(0)
  })

  it('reconstructs the graded (short-answer) outcome from score, not just the correct flag', () => {
    // score=40 -> overall=4.0 -> gradedDelta(<=4) = -2, so confidence should be
    // 5 - 2 = 3. record.ts also stores correct=false for this row (overall < 8).
    // If recompute wrongly replayed this as a plain {correct:false} binary
    // event, confidence would come out as 4 instead of 3 - this discriminates.
    const events: RecomputeEvent[] = [
      { correct: false, score: 40, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result!.confidence).toBe(3)
    expect(result!.reps).toBe(0) // reps/dueAt use the stored `correct` flag directly
  })

  it('replays multiple events in chronological order regardless of input array order', () => {
    // Chronological: correct(t1) -> wrong(t2) -> correct(t3)
    // t1: confidence 5->6, reps 0->1
    // t2: confidence 6->5, reps ->0
    // t3: confidence 5->6, reps 0->1
    const chronological: RecomputeEvent[] = [
      { correct: true, score: null, createdAt: t1 },
      { correct: false, score: null, createdAt: t2 },
      { correct: true, score: null, createdAt: t3 },
    ]
    const shuffled = [chronological[2], chronological[0], chronological[1]]

    const expected = recomputeCardProgress(chronological)
    const actual = recomputeCardProgress(shuffled)

    expect(actual!.confidence).toBe(6)
    expect(actual!.reps).toBe(1)
    expect(actual!.lastSeenAt.getTime()).toBe(t3.getTime())
    expect(actual).toEqual(expected)
  })

  it('mastery matches calling masteryScore directly over the same remaining events', () => {
    const events: RecomputeEvent[] = [
      { correct: true, score: null, createdAt: t1 },
      { correct: false, score: null, createdAt: t2 },
    ]
    const result = recomputeCardProgress(events)
    expect(result!.mastery).toBe(masteryScore(events))
  })
})
