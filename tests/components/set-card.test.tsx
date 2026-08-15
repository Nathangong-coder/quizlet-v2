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

describe('SetCard study signal', () => {
  it('shows confidence, progress and due count for a studied set', () => {
    render(<SetCard set={SET} summary={summary({ dueCount: 3 })} />)
    expect(screen.getByText('confidence 6.5/10')).toBeTruthy()
    expect(screen.getByText('6 of 24 studied')).toBeTruthy()
    expect(screen.getByText('3 due')).toBeTruthy()
  })

  it('shows NOTHING for an unstudied set — not a zero', () => {
    // "confidence 0.0/10 · 0 of 24 studied" reads as a judgement about
    // material nobody has opened. Absent is the honest rendering.
    render(<SetCard set={SET} summary={undefined} />)
    expect(screen.queryByText(/confidence/)).toBeNull()
    expect(screen.queryByText(/studied/)).toBeNull()
    expect(screen.queryByText(/due/)).toBeNull()
  })

  it('shows nothing when a summary exists but nothing was studied', () => {
    render(<SetCard set={SET} summary={EMPTY_SET_SUMMARY} />)
    expect(screen.queryByText(/confidence/)).toBeNull()
  })

  it('hides the due badge at zero rather than rendering "0 due"', () => {
    render(<SetCard set={SET} summary={summary({ dueCount: 0 })} />)
    expect(screen.getByText('6 of 24 studied')).toBeTruthy()
    expect(screen.queryByText(/due/)).toBeNull()
  })

  it('omits confidence when it is null but cards were counted', () => {
    render(<SetCard set={SET} summary={summary({ averageConfidence: null })} />)
    expect(screen.queryByText(/confidence/)).toBeNull()
    expect(screen.getByText('6 of 24 studied')).toBeTruthy()
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
