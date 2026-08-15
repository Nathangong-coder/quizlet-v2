import { describe, it, expect } from 'vitest'
import { shapeSetSummaries, type SetProgressRow } from '@/lib/sets/study-summary'

const NOW = new Date('2026-08-14T12:00:00.000Z')
const at = (iso: string) => new Date(iso)

function row(over: Partial<SetProgressRow> = {}): SetProgressRow {
  return {
    setId: 'set-a',
    confidence: 5,
    dueAt: at('2026-09-01T00:00:00.000Z'),
    updatedAt: at('2026-08-01T00:00:00.000Z'),
    ...over,
  }
}

describe('shapeSetSummaries', () => {
  it('omits a set with no progress rows ENTIRELY, rather than zeroing it', () => {
    // Absence is where the null-is-not-zero rule lives. A set nobody has
    // opened gets no entry at all, so the caller renders nothing — it must not
    // read as "you know none of this".
    expect(shapeSetSummaries([], NOW)).toEqual({})
    expect(shapeSetSummaries([row({ setId: 'a' })], NOW)['b']).toBeUndefined()
  })

  it('averages confidence over studied cards only', () => {
    const out = shapeSetSummaries([row({ confidence: 4 }), row({ confidence: 8 })], NOW)
    expect(out['set-a'].averageConfidence).toBe(6)
    expect(out['set-a'].studiedCards).toBe(2)
  })

  it('keeps each set separate', () => {
    const out = shapeSetSummaries(
      [row({ setId: 'a', confidence: 2 }), row({ setId: 'b', confidence: 10 })],
      NOW,
    )
    expect(out.a.averageConfidence).toBe(2)
    expect(out.b.averageConfidence).toBe(10)
  })
})

describe('what counts as DUE — must match getDueCards', () => {
  it('counts a NULL dueAt as due', () => {
    // `getDueCards` (schedule.ts:185) is `OR: [{ dueAt: null }, { dueAt: lte now }]`.
    // Null means never scheduled, which is a reason to review, not to hide.
    // Diverging here makes this list report fewer due cards than Review mode
    // then offers, and nothing tells the learner which surface is lying.
    const out = shapeSetSummaries([row({ dueAt: null })], NOW)
    expect(out['set-a'].dueCount).toBe(1)
  })

  it('counts a past dueAt as due', () => {
    expect(shapeSetSummaries([row({ dueAt: at('2026-08-01T00:00:00.000Z') })], NOW)['set-a'].dueCount)
      .toBe(1)
  })

  it('counts dueAt EXACTLY now as due', () => {
    // `<=`, not `<`. Excluding the boundary makes a card skip the instant it
    // becomes actionable.
    expect(shapeSetSummaries([row({ dueAt: NOW })], NOW)['set-a'].dueCount).toBe(1)
  })

  it('does NOT count a future dueAt', () => {
    // The other half — without it, "everything is due" would pass every test
    // above.
    expect(
      shapeSetSummaries([row({ dueAt: at('2026-12-01T00:00:00.000Z') })], NOW)['set-a'].dueCount,
    ).toBe(0)
  })

  it('counts only the due subset of a mixed set', () => {
    const out = shapeSetSummaries(
      [
        row({ dueAt: null }),
        row({ dueAt: at('2026-08-13T00:00:00.000Z') }),
        row({ dueAt: at('2026-12-01T00:00:00.000Z') }),
      ],
      NOW,
    )
    expect(out['set-a'].dueCount).toBe(2)
    expect(out['set-a'].studiedCards).toBe(3)
  })
})

describe('lastStudiedAt', () => {
  it('takes the most recent update, not the first or last row seen', () => {
    const out = shapeSetSummaries(
      [
        row({ updatedAt: at('2026-08-02T00:00:00.000Z') }),
        row({ updatedAt: at('2026-08-10T00:00:00.000Z') }),
        row({ updatedAt: at('2026-08-05T00:00:00.000Z') }),
      ],
      NOW,
    )
    expect(out['set-a'].lastStudiedAt).toEqual(at('2026-08-10T00:00:00.000Z'))
  })
})
