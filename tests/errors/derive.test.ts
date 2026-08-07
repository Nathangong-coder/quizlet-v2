import { describe, it, expect } from 'vitest'
import {
  deriveTagScores, toStoredTags, type StoredTag, type RawTagRow,
} from '@/lib/errors/derive'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const minsAgo = (n: number): Date => new Date(NOW.getTime() - n * 60_000)

function tag(overrides: Partial<StoredTag> & { attemptId: string }): StoredTag {
  return {
    cardId: 'card1',
    dimension: 'accuracy',
    type: 'inversion',
    klpId: 'klp1',
    relevance: 3,
    starred: false,
    magnitude: 10,
    storedSeverity: 5,
    storedSignificance: 8,
    mode: 'quiz-sa',
    createdAt: NOW,
    ...overrides,
  }
}

describe('derivation from magnitude', () => {
  it('recomputes severity from the band rather than trusting the stored value', () => {
    const [derived] = deriveTagScores([tag({ attemptId: 'a1', magnitude: 1, storedSeverity: 5 })])
    expect(derived.severity).toBe(2) // inversion band [2,5] at magnitude 1
  })

  it('honours a caller-supplied band table', () => {
    const [derived] = deriveTagScores(
      [tag({ attemptId: 'a1', magnitude: 10 })],
      { inversion: [1, 2] },
    )
    expect(derived.severity).toBe(2)
  })
})

describe('legacy rows', () => {
  it('falls back to the stored severity when magnitude is null', () => {
    const [derived] = deriveTagScores([
      tag({ attemptId: 'a1', magnitude: null, storedSeverity: 4 }),
    ])
    expect(derived.severity).toBe(4)
    expect(derived.isLegacy).toBe(true)
  })
})

describe('repeatBonus', () => {
  it('adds +1 when the same (type, target) recurs within the last 3 attempts', () => {
    const tags = [
      tag({ attemptId: 'a1', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a2', createdAt: minsAgo(20) }),
    ]
    const derived = deriveTagScores(tags)
    expect(derived[0].repeatBonus).toBe(0)
    expect(derived[1].repeatBonus).toBe(1)
  })

  it('does not fire across a different type on the same KLP', () => {
    const derived = deriveTagScores([
      tag({ attemptId: 'a1', type: 'inversion', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a2', type: 'omission', createdAt: minsAgo(20) }),
    ])
    expect(derived[1].repeatBonus).toBe(0)
  })

  it('does not fire once the earlier occurrence is 4 attempts back', () => {
    const derived = deriveTagScores([
      tag({ attemptId: 'a1', createdAt: minsAgo(50) }),
      tag({ attemptId: 'a2', type: 'omission', createdAt: minsAgo(40) }),
      tag({ attemptId: 'a3', type: 'omission', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a4', type: 'omission', createdAt: minsAgo(20) }),
      tag({ attemptId: 'a5', createdAt: minsAgo(10) }),
    ])
    // a1 is attempt 0, a5 is attempt 4, distance = 4 - 0 = 4 which exceeds window
    expect(derived[4].repeatBonus).toBe(0)
  })

  it('pins the boundary: fires exactly at distance 3, not at distance 4', () => {
    const derived = deriveTagScores([
      tag({ attemptId: 'a1', createdAt: minsAgo(50) }),
      tag({ attemptId: 'a2', type: 'other', createdAt: minsAgo(40) }),
      tag({ attemptId: 'a3', type: 'other', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a4', createdAt: minsAgo(20) }),
    ])
    // a1 is attempt 0, a4 is attempt 3, distance = 3 - 0 = 3, should fire
    expect(derived[3].repeatBonus).toBe(1)
  })

  it('does not allow tags in the same attempt to trigger each other', () => {
    const derived = deriveTagScores([
      tag({ attemptId: 'a1', klpId: 'klp1', type: 'inversion', createdAt: minsAgo(20) }),
      tag({ attemptId: 'a1', klpId: 'klp1', type: 'inversion', createdAt: minsAgo(19) }),
    ])
    expect(derived[0].repeatBonus).toBe(0)
    expect(derived[1].repeatBonus).toBe(0)
  })

  it('produces identical scores regardless of input order', () => {
    const tags = [
      tag({ attemptId: 'a1', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a2', createdAt: minsAgo(20) }),
      tag({ attemptId: 'a3', createdAt: minsAgo(10) }),
    ]
    const inOrder = deriveTagScores(tags)
    const reversed = deriveTagScores([...tags].reverse())
    // Match by attemptId since order may differ
    const byId = new Map(reversed.map((d) => [d.attemptId, d]))
    for (const d of inOrder) {
      const rev = byId.get(d.attemptId)
      expect(rev).toBeDefined()
      expect(rev!.severity).toBe(d.severity)
      expect(rev!.repeatBonus).toBe(d.repeatBonus)
      expect(rev!.significance).toBe(d.significance)
    }
  })

  it('counts CLEAN attempts in the window when the real sequence is supplied', () => {
    // Two occurrences of the same (type, target) with four flawless sittings
    // between them. Every fixture above happens to have one tag per attempt,
    // which is precisely why the bug survived: deriving the sequence from the
    // tags makes clean attempts invisible, and the gap collapses to 1.
    const tags = [
      tag({ attemptId: 'a1', createdAt: minsAgo(60) }),
      tag({ attemptId: 'a6', createdAt: minsAgo(10) }),
    ]
    const realOrder = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']

    expect(deriveTagScores(tags, undefined, realOrder)[1].repeatBonus).toBe(0)
    // Without the real sequence the same two tags look adjacent.
    expect(deriveTagScores(tags)[1].repeatBonus).toBe(1)
  })

  it('still fires inside the window when the clean attempts are few', () => {
    const tags = [
      tag({ attemptId: 'a1', createdAt: minsAgo(60) }),
      tag({ attemptId: 'a4', createdAt: minsAgo(10) }),
    ]
    expect(deriveTagScores(tags, undefined, ['a1', 'a2', 'a3', 'a4'])[1].repeatBonus).toBe(1)
    expect(deriveTagScores(tags, undefined, ['a1', 'a2', 'a3', 'x', 'a4'])[1].repeatBonus).toBe(0)
  })

  it('does not let scope change a tag score once the real sequence is supplied', () => {
    // The narrower "view" drops the intervening tag entirely. With the real
    // attempt sequence the distance — and so the score — is unchanged.
    const wide = [
      tag({ attemptId: 'a1', createdAt: minsAgo(60) }),
      tag({ attemptId: 'a2', type: 'omission', createdAt: minsAgo(50) }),
      tag({ attemptId: 'a3', type: 'omission', createdAt: minsAgo(40) }),
      tag({ attemptId: 'a4', type: 'omission', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a6', createdAt: minsAgo(10) }),
    ]
    const narrow = [wide[0], wide[4]]
    const order = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']

    const wideScore = deriveTagScores(wide, undefined, order).find((d) => d.attemptId === 'a6')!
    const narrowScore = deriveTagScores(narrow, undefined, order).find((d) => d.attemptId === 'a6')!
    expect(narrowScore.repeatBonus).toBe(wideScore.repeatBonus)
    expect(narrowScore.significance).toBe(wideScore.significance)

    // Without the real sequence the two views disagree: the wide view's
    // intervening tags hold the distance open, the narrow view's do not.
    expect(deriveTagScores(wide).find((d) => d.attemptId === 'a6')!.repeatBonus).toBe(0)
    expect(deriveTagScores(narrow).find((d) => d.attemptId === 'a6')!.repeatBonus).toBe(1)
  })

  it('appends an attempt missing from the supplied sequence rather than collapsing it', () => {
    // A tag whose attempt the caller did not list must not land at index 0
    // alongside every other unknown attempt — that would make unrelated tags
    // look like they happened in the same sitting.
    const derived = deriveTagScores(
      [
        tag({ attemptId: 'ghost1', createdAt: minsAgo(30) }),
        tag({ attemptId: 'ghost2', createdAt: minsAgo(20) }),
      ],
      undefined,
      ['a1', 'a2'],
    )
    expect(derived[0].repeatBonus).toBe(0)
    expect(derived[1].repeatBonus).toBe(1)
  })

  it('never pushes significance above 10', () => {
    const tags = [
      tag({ attemptId: 'a1', relevance: 5, starred: true, createdAt: minsAgo(30) }),
      tag({ attemptId: 'a2', relevance: 5, starred: true, createdAt: minsAgo(20) }),
    ]
    const derived = deriveTagScores(tags)
    expect(derived[1].significance).toBeLessThanOrEqual(10)
  })
})

describe('toStoredTags', () => {
  const row = (o: Partial<RawTagRow> = {}): RawTagRow => ({
    dimension: 'accuracy', type: 'inversion', klpId: 'klp1',
    relevance: 3, starred: false, magnitude: 8, mode: 'quiz-mc',
    severity: 4, significance: 7, createdAt: NOW,
    quizAnswer: { attemptId: 'att1', cardId: 'card1' },
    ...o,
  })

  it('lifts the attemptId out of the joined answer', () => {
    expect(toStoredTags([row()])[0].attemptId).toBe('att1')
  })

  it('lifts the cardId out too, so whole-answer tags stay attributable', () => {
    expect(toStoredTags([row()])[0].cardId).toBe('card1')
  })

  it('falls back to quiz-sa for a legacy row with no stored mode', () => {
    // quiz-sa is the only mode with no dock, so a legacy tag is never docked
    // on a guess. Its severity comes from storedSeverity regardless.
    const stored = toStoredTags([row({ mode: null, magnitude: null })])
    expect(stored[0].mode).toBe('quiz-sa')
    expect(stored[0].magnitude).toBeNull()
    expect(stored[0].storedSeverity).toBe(4)
  })

  it('preserves a stored mode when present', () => {
    expect(toStoredTags([row({ mode: 'quiz-tf' })])[0].mode).toBe('quiz-tf')
  })
})
