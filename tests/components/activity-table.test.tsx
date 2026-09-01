// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ActivityTable, { outcomeText } from '@/components/memory/ActivityTable'
import type { StudyEventHistoryRow } from '@/actions/memory'

afterEach(cleanup)

function event(over: Partial<StudyEventHistoryRow> = {}): StudyEventHistoryRow {
  return {
    id: 'e1',
    cardId: 'c1',
    term: 'Weighted Average Cost of Capital',
    setId: 's1',
    setTitle: 'Valuation',
    source: 'quiz-sa',
    correct: null,
    score: 82,
    latencyMs: 2400,
    confidenceAfter: 7,
    createdAt: new Date(2026, 7, 14, 9, 30).toISOString(),
    sessionId: 'sess1',
    ...over,
  }
}

describe('outcomeText keeps three outcomes distinguishable', () => {
  it('renders a graded score as a percentage', () => {
    expect(outcomeText({ score: 82, correct: null })).toBe('82%')
  })

  it('renders a pass/fail verdict in words', () => {
    expect(outcomeText({ score: null, correct: true })).toBe('Correct')
    expect(outcomeText({ score: null, correct: false })).toBe('Wrong')
  })

  it('renders NO judgement as a dash, not as a failure', () => {
    // A Review-mode answer records confidence without correctness. Showing it
    // as 0% or "Wrong" invents a mistake the learner never made.
    expect(outcomeText({ score: null, correct: null })).toBe('—')
  })

  it('prefers the score over the verdict when an answer carries both', () => {
    // A short answer scored 40 is also `correct: false`; "40%" says more than
    // "Wrong", and the two must not both render.
    expect(outcomeText({ score: 40, correct: false })).toBe('40%')
  })

  it('does not swallow a legitimate zero score', () => {
    // `score !== null` rather than a truthiness check: 0 is a real grade, and
    // `if (score)` would fall through to the verdict branch.
    expect(outcomeText({ score: 0, correct: false })).toBe('0%')
  })
})

describe('ActivityTable rows open the activity, not a filtered copy of the list', () => {
  it('links the card name to the activity permalink', () => {
    render(<ActivityTable events={[event()]} onScopeToCard={() => {}} onDelete={() => {}} />)
    const link = screen.getByRole('link', { name: /Weighted Average Cost of Capital/ })
    expect(link.getAttribute('href')).toBe('/profile/activity/sess1')
  })

  it('renders a row with no session as text, never as a dead link', () => {
    // `StudyEvent.sessionId` is SetNull and predates StudySession, so null rows
    // are ordinary history. A link here would point at /profile/activity/null.
    render(
      <ActivityTable
        events={[event({ sessionId: null })]}
        onScopeToCard={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Weighted Average Cost of Capital')).toBeTruthy()
  })

  it('keeps card scope reachable as its own control', () => {
    // This is the ONLY route into card scope, which is the only route to
    // "Forget this card" — an affordance already lost once. The row click was
    // reassigned to the permalink, so it has to survive somewhere.
    const onScopeToCard = vi.fn()
    const row = event()
    render(<ActivityTable events={[row]} onScopeToCard={onScopeToCard} onDelete={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /Show only Weighted Average/ }))
    expect(onScopeToCard).toHaveBeenCalledWith(row)
  })

  it('still offers per-entry deletion', () => {
    const onDelete = vi.fn()
    render(<ActivityTable events={[event()]} onScopeToCard={() => {}} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: /Delete Weighted Average/ }))
    expect(onDelete).toHaveBeenCalledWith('e1')
  })
})

describe('ActivityTable columns', () => {
  it('shows set, activity type, accuracy and confidence for each row', () => {
    render(<ActivityTable events={[event()]} onScopeToCard={() => {}} onDelete={() => {}} />)
    expect(screen.getByText('Valuation')).toBeTruthy()
    // The short label, not "Quiz (Short Answer)" — the column is already
    // headed "Type" and the prefix repeated on every row.
    expect(screen.getByText('Short Answer')).toBeTruthy()
    expect(screen.getByText('2s')).toBeTruthy()
    expect(screen.getByText('82%')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
  })

  it('gives every row the same column template as the header', () => {
    // The columns are a shared grid string. If a row and the header ever get
    // different templates the table silently stops lining up.
    const { container } = render(
      <ActivityTable
        events={[event(), event({ id: 'e2', term: 'EBITDA' })]}
        onScopeToCard={() => {}}
        onDelete={() => {}}
      />,
    )
    const templates = Array.from(container.querySelectorAll('.grid')).map(
      (el) => Array.from(el.classList).find((c) => c.startsWith('grid-cols-')),
    )
    expect(templates.length).toBe(3) // header + two rows
    expect(new Set(templates).size).toBe(1)
  })

  it('renders every event it is given', () => {
    render(
      <ActivityTable
        events={[event(), event({ id: 'e2', term: 'EBITDA' })]}
        onScopeToCard={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByText('EBITDA')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Delete/ })).toHaveLength(2)
  })
})
