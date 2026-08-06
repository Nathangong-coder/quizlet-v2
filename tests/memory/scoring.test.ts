import { describe, it, expect } from 'vitest'
import { nextConfidence, masteryScore, masteryBucket, eventRecalled, RECALL_THRESHOLD } from '@/lib/memory/scoring'
import type { MasteryEvent } from '@/lib/memory/scoring'

describe('nextConfidence — binary outcomes (review, quiz-mc, quiz-tf, matching)', () => {
  it('increments by 1 when correct', () => {
    expect(nextConfidence(5, { correct: true })).toBe(6)
  })

  it('decrements by 1 when incorrect', () => {
    expect(nextConfidence(5, { correct: false })).toBe(4)
  })

  it('clamps at 10 when already at max', () => {
    expect(nextConfidence(10, { correct: true })).toBe(10)
  })

  it('clamps at 1 when already at min', () => {
    expect(nextConfidence(1, { correct: false })).toBe(1)
  })
})

describe('nextConfidence — graded outcomes (quiz-sa, overall 1-10 scale)', () => {
  it('grants +1 for a high grade (>= 8)', () => {
    expect(nextConfidence(5, { overall: 8 })).toBe(6)
    expect(nextConfidence(5, { overall: 10 })).toBe(6)
  })

  it('penalizes -2 for a low grade (<= 4)', () => {
    expect(nextConfidence(5, { overall: 4 })).toBe(3)
    expect(nextConfidence(5, { overall: 1 })).toBe(3)
  })

  it('penalizes -1 for a mid-low grade (5-6)', () => {
    expect(nextConfidence(5, { overall: 5 })).toBe(4)
    expect(nextConfidence(5, { overall: 6 })).toBe(4)
  })

  it('leaves confidence unchanged for a borderline grade (7)', () => {
    expect(nextConfidence(5, { overall: 7 })).toBe(5)
  })

  it('clamps at bounds for graded outcomes too', () => {
    expect(nextConfidence(10, { overall: 9 })).toBe(10)
    expect(nextConfidence(1, { overall: 2 })).toBe(1)
  })
})

describe('masteryScore', () => {
  const at = (secondsAgo: number): Date => new Date(Date.now() - secondsAgo * 1000)

  it('returns null for an empty event list', () => {
    expect(masteryScore([])).toBeNull()
  })

  it('returns null when no events carry a usable signal', () => {
    const events: MasteryEvent[] = [{ createdAt: at(0) }, { createdAt: at(10) }]
    expect(masteryScore(events)).toBeNull()
  })

  it('scores 100 when every recent event is correct (all-right)', () => {
    const events: MasteryEvent[] = [
      { correct: true, createdAt: at(0) },
      { correct: true, createdAt: at(10) },
      { correct: true, createdAt: at(20) },
    ]
    expect(masteryScore(events)).toBe(100)
  })

  it('scores 0 when every recent event is wrong (all-wrong)', () => {
    const events: MasteryEvent[] = [
      { correct: false, createdAt: at(0) },
      { correct: false, createdAt: at(10) },
      { correct: false, createdAt: at(20) },
    ]
    expect(masteryScore(events)).toBe(0)
  })

  it('lands strictly between 0 and 100 for an oscillating sequence', () => {
    const events: MasteryEvent[] = [
      { correct: true, createdAt: at(0) },
      { correct: false, createdAt: at(10) },
      { correct: true, createdAt: at(20) },
      { correct: false, createdAt: at(30) },
    ]
    const score = masteryScore(events)!
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })

  it('weighs a recent miss more heavily than an older one (high-conf-then-miss)', () => {
    // Long streak of correct answers, then a single recent miss.
    const mostlyRightThenMiss: MasteryEvent[] = [
      { correct: false, createdAt: at(0) },
      { correct: true, createdAt: at(10) },
      { correct: true, createdAt: at(20) },
      { correct: true, createdAt: at(30) },
      { correct: true, createdAt: at(40) },
    ]
    // Same composition, but the miss is the oldest event instead of the newest.
    const missThenMostlyRight: MasteryEvent[] = [
      { correct: true, createdAt: at(0) },
      { correct: true, createdAt: at(10) },
      { correct: true, createdAt: at(20) },
      { correct: true, createdAt: at(30) },
      { correct: false, createdAt: at(40) },
    ]

    const recentMissScore = masteryScore(mostlyRightThenMiss)!
    const oldMissScore = masteryScore(missThenMostlyRight)!

    expect(recentMissScore).toBeLessThan(oldMissScore)
  })

  it('is independent of input order (sorts by createdAt internally)', () => {
    const chronological: MasteryEvent[] = [
      { correct: true, createdAt: at(30) },
      { correct: false, createdAt: at(20) },
      { correct: true, createdAt: at(10) },
      { correct: false, createdAt: at(0) },
    ]
    const shuffled = [chronological[2], chronological[0], chronological[3], chronological[1]]

    expect(masteryScore(shuffled)).toBe(masteryScore(chronological))
  })

  it('uses graded score (0-100) when correct is not set', () => {
    const events: MasteryEvent[] = [
      { score: 80, createdAt: at(0) },
      { score: 60, createdAt: at(10) },
    ]
    const score = masteryScore(events)!
    expect(score).toBeGreaterThan(60)
    expect(score).toBeLessThan(80)
  })

  it('prefers the graded score over correct when both are set', () => {
    // recordStudyEvent writes both fields for graded answers, deriving
    // `correct` as `overall >= 8`. Mastery must read the precise score, not
    // the thresholded boolean, or every graded answer collapses to 0 or 100.
    expect(masteryScore([{ correct: false, score: 70, createdAt: at(0) }])).toBe(70)
    expect(masteryScore([{ correct: true, score: 90, createdAt: at(0) }])).toBe(90)
  })

  it('still uses correct for binary modes, where score is null', () => {
    expect(masteryScore([{ correct: true, score: null, createdAt: at(0) }])).toBe(100)
    expect(masteryScore([{ correct: false, score: null, createdAt: at(0) }])).toBe(0)
  })

  it('only considers the most recent window of events', () => {
    // A full window (10) of recent perfect scores followed by a long tail of
    // wrong answers far in the past — without windowing, the tail would drag
    // the score down, but the function should cap how far back it looks.
    const recentPerfect: MasteryEvent[] = Array.from({ length: 10 }, (_, i) => ({
      correct: true,
      createdAt: at(i * 10),
    }))
    const oldWrongTail: MasteryEvent[] = Array.from({ length: 50 }, (_, i) => ({
      correct: false,
      createdAt: at(1000 + i * 10),
    }))

    expect(masteryScore([...recentPerfect, ...oldWrongTail])).toBe(100)
  })
})

describe('eventRecalled', () => {
  const at = (secondsAgo: number): Date => new Date(Date.now() - secondsAgo * 1000)

  it('returns null when the event carries no usable signal', () => {
    expect(eventRecalled({ createdAt: at(0) })).toBeNull()
  })

  it('reads a binary correct event straight through', () => {
    expect(eventRecalled({ correct: true, createdAt: at(0) })).toBe(true)
    expect(eventRecalled({ correct: false, createdAt: at(0) })).toBe(false)
  })

  it('confirms the threshold constant is 0.5', () => {
    expect(RECALL_THRESHOLD).toBe(0.5)
  })

  it('treats a graded score at exactly the threshold as recalled (inclusive)', () => {
    expect(eventRecalled({ score: 50, createdAt: at(0) })).toBe(true)
  })

  it('treats a graded score one point below the threshold as not recalled', () => {
    expect(eventRecalled({ score: 49, createdAt: at(0) })).toBe(false)
  })

  it('treats a high graded score as recalled and a low one as not', () => {
    expect(eventRecalled({ score: 90, createdAt: at(0) })).toBe(true)
    expect(eventRecalled({ score: 10, createdAt: at(0) })).toBe(false)
  })

  it('prefers the graded score over correct when both are set, same as eventCorrectness', () => {
    expect(eventRecalled({ correct: true, score: 10, createdAt: at(0) })).toBe(false)
    expect(eventRecalled({ correct: false, score: 90, createdAt: at(0) })).toBe(true)
  })
})

describe('masteryBucket', () => {
  it('requires both high mastery and high confidence for mastered', () => {
    expect(masteryBucket({ confidence: 9, mastery: 85 })).toBe('mastered')
    expect(masteryBucket({ confidence: 7, mastery: 85 })).toBe('solid')
    expect(masteryBucket({ confidence: 9, mastery: 50 })).toBe('solid')
  })

  it('treats a null mastery as unknown, never as zero', () => {
    // Cards last touched before Stage 6 Task 4 have mastery === null. Reading
    // that as 0 would file a well-known card under Struggling.
    expect(masteryBucket({ confidence: 9, mastery: null })).toBe('solid')
    expect(masteryBucket({ confidence: 5, mastery: null })).toBe('shaky')
    expect(masteryBucket({ confidence: 2, mastery: null })).toBe('struggling')
  })

  it('falls through solid -> shaky -> struggling on confidence', () => {
    expect(masteryBucket({ confidence: 7, mastery: 10 })).toBe('solid')
    expect(masteryBucket({ confidence: 6, mastery: 10 })).toBe('shaky')
    expect(masteryBucket({ confidence: 4, mastery: 10 })).toBe('shaky')
    expect(masteryBucket({ confidence: 3, mastery: 10 })).toBe('struggling')
  })

  it('promotes on mastery alone at the solid threshold', () => {
    expect(masteryBucket({ confidence: 3, mastery: 65 })).toBe('solid')
  })

  it('treats the mastered thresholds as inclusive, one point below as not', () => {
    expect(masteryBucket({ confidence: 8, mastery: 80 })).toBe('mastered')
    expect(masteryBucket({ confidence: 7, mastery: 80 })).toBe('solid')
    expect(masteryBucket({ confidence: 8, mastery: 79 })).toBe('solid')
  })

  it('treats the solid mastery threshold as inclusive, one point below as not', () => {
    // Confidence is held below every confidence-driven threshold so these
    // assertions can only be satisfied by the mastery rule.
    expect(masteryBucket({ confidence: 3, mastery: 60 })).toBe('solid')
    expect(masteryBucket({ confidence: 3, mastery: 59 })).toBe('struggling')
  })
})
