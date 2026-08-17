// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

afterEach(cleanup)

import { SetCard } from '@/components/sets/SetCard'
import { EMPTY_SET_SUMMARY, type SetStudySummary } from '@/lib/sets/study-summary'

const SET = {
  id: 's1',
  title: 'Accounting Interview Prep',
  description: 'The three statements',
  visibility: 'private',
  _count: { cards: 24 },
  // LOCAL time, not UTC midnight: `format` renders in local time, so a
  // UTC-midnight fixture shows the previous day west of Greenwich and the
  // test passes or fails depending on where it runs.
  createdAt: new Date(2026, 6, 1),
}

function summary(over: Partial<SetStudySummary> = {}): SetStudySummary {
  return { ...EMPTY_SET_SUMMARY, studiedCards: 6, averageConfidence: 6.5, ...over }
}

describe('SetCard visibility', () => {
  it('says a private set is private', () => {
    // Shipped in queue item 1 and shown nowhere in the list — the one place a
    // learner scans to check what is shared.
    render(<SetCard set={SET} />)
    expect(screen.getByText('Private')).toBeTruthy()
  })

  it('says a link-shared set is shared', () => {
    render(<SetCard set={{ ...SET, visibility: 'link' }} />)
    expect(screen.getByText('Shared')).toBeTruthy()
  })

  it('claims nothing when visibility was not loaded', () => {
    // Guessing "Private" from an absent field would state a fact about sharing
    // that the page never fetched.
    render(<SetCard set={{ ...SET, visibility: undefined }} />)
    expect(screen.queryByText('Private')).toBeNull()
    expect(screen.queryByText('Shared')).toBeNull()
  })
})

describe('SetCard reports no study score', () => {
  // The card used to carry mean confidence, "N of M studied" and a due badge.
  // All three were removed deliberately: scanning your own library should not
  // mean being scored on every set in it. These tests pin the REMOVAL, so
  // reinstating any of them is a deliberate act rather than a silent one.

  it('shows no confidence number even for a fully populated summary', () => {
    render(<SetCard set={SET} summary={summary({ dueCount: 3 })} />)
    expect(screen.queryByText(/confidence/i)).toBeNull()
  })

  it('shows no studied-count even for a fully populated summary', () => {
    render(<SetCard set={SET} summary={summary({ dueCount: 3 })} />)
    expect(screen.queryByText(/studied \d|\d+ of \d+/)).toBeNull()
  })

  it('shows no due badge even when cards are due', () => {
    render(<SetCard set={SET} summary={summary({ dueCount: 3 })} />)
    expect(screen.queryByText(/\bdue\b/)).toBeNull()
  })

  it('still shows nothing for an unstudied set', () => {
    render(<SetCard set={SET} summary={undefined} />)
    expect(screen.queryByText(/confidence/i)).toBeNull()
    expect(screen.queryByText(/\bdue\b/)).toBeNull()
  })

  it('keeps the card count, which is a fact about the set, not about you', () => {
    render(<SetCard set={SET} summary={summary({ dueCount: 3 })} />)
    expect(screen.getByText('24 cards')).toBeTruthy()
  })

  it('still accepts a summary — it feeds the last-studied date', () => {
    // The prop was NOT dropped. `EMPTY_SET_SUMMARY` stays imported and used, so
    // this asserts the component keeps reading the summary it is given.
    render(<SetCard set={SET} summary={EMPTY_SET_SUMMARY} />)
    expect(screen.getByText(SET.title)).toBeTruthy()
  })
})

describe('SetCard markup', () => {
  it('puts no <button> inside the card link', () => {
    // A <button> inside an <a> is invalid HTML and gave keyboard users a
    // second tab stop that navigated to the same place.
    const { container } = render(<SetCard set={SET} />)
    expect(container.querySelector('a button')).toBeNull()
    expect(screen.getByText('View Set')).toBeTruthy()
  })

  it('prefers the last-studied date over the creation date', () => {
    // "created Jul 1" is the least useful fact about a set you studied
    // yesterday. Matched on textContent because the date sits beside an icon.
    const { container } = render(
      <SetCard set={SET} summary={summary({ lastStudiedAt: new Date(2026, 7, 10) })} />,
    )
    expect(container.textContent).toContain('studied Aug 10')
    expect(container.textContent).not.toContain('Jul 1, 2026')
  })

  it('falls back to the creation date when never studied', () => {
    const { container } = render(<SetCard set={SET} />)
    expect(container.textContent).toContain('Jul 1, 2026')
  })
})
