// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { studyNext, memberTotals, countNobody, type PulseOverview } from '@/lib/groups/pulse'
import { CoverageGrid } from '@/components/groups/CoverageGrid'
import { GroupTabs } from '@/components/groups/GroupTabs'

afterEach(cleanup)

const m = (userId: string, handle: string | null = userId) => ({ userId, handle })
const standing = (userId: string, mastered: number, studied: number, rank: number) => ({ userId, handle: userId, mastered, studied, unstudied: 3 - studied, averageConfidence: 7, lastStudiedAt: null, timeMs: 0, rank })

const overview: Record<string, PulseOverview> = {
  s1: {
    cards: [{ id: 'c1', term: 'DTL' }, { id: 'c2', term: 'WACC' }, { id: 'c3', term: 'Goodwill' }],
    leaderboard: {
      setId: 's1',
      cardCount: 3,
      standings: [standing('maya', 2, 3, 1), standing('you', 1, 2, 2)],
      cards: [
        { cardId: 'c1', masteredBy: [m('maya'), m('you')], learningBy: [] },
        { cardId: 'c2', masteredBy: [m('maya')], learningBy: [m('you')] },
        { cardId: 'c3', masteredBy: [], learningBy: [] },
      ],
    },
  },
}

describe('group pulse', () => {
  it('study next: fewest mastered first, momentum breaks ties; nobody count; member totals', () => {
    const next = studyNext([{ setId: 's1', title: 'Accounting', readable: true }, { setId: 'gone', title: '', readable: false }], overview, 2, 10)
    expect(next.map((c) => [c.term, c.masteredCount, c.learningCount])).toEqual([['Goodwill', 0, 0], ['WACC', 1, 1], ['DTL', 2, 0]])
    expect(next[0].setTitle).toBe('Accounting')
    expect(studyNext([{ setId: 's1', title: 'A', readable: true }], overview, 2, 1)).toHaveLength(1)
    expect(countNobody(overview)).toBe(1)
    const totals = memberTotals(['maya', 'you', 'ghost'], overview)
    expect(totals.get('maya')).toEqual({ mastered: 2, learning: 1 })
    expect(totals.get('you')).toEqual({ mastered: 1, learning: 1 })
    expect(totals.get('ghost')).toEqual({ mastered: 0, learning: 0 })
  })
})

describe('CoverageGrid', () => {
  it('draws a card × member grid, hardest first, and narrows to one member’s gaps', () => {
    render(<CoverageGrid board={overview.s1.leaderboard} cards={overview.s1.cards} viewerId="you" />)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Goodwill', 'WACC', 'DTL'])
    // Cells name their state for a screen reader.
    expect(within(rows[1]).getByRole('img', { name: 'you: learning' })).toBeTruthy()
    expect(within(rows[2]).getByRole('img', { name: '@maya: mastered' })).toBeTruthy()
    expect(within(rows[0]).getByText(/nobody yet/)).toBeTruthy()
    expect(within(rows[2]).getByText(/everyone/)).toBeTruthy()
    // Pick "you": only the cards you have not mastered remain.
    fireEvent.click(screen.getByRole('button', { name: 'you' }))
    expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Goodwill', 'WACC'])
    // Search narrows further.
    fireEvent.change(screen.getByLabelText(/find a card/i), { target: { value: 'wacc' } })
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1)
  })
})

describe('GroupTabs', () => {
  it('switches panels without a fetch, honours the initial tab, and moves with arrow keys', () => {
    render(
      <GroupTabs
        tabs={[{ key: 'overview', label: 'Overview' }, { key: 'sets', label: 'Sets', count: 2 }, { key: 'members', label: 'Members', count: 3 }]}
        initial="sets"
        panels={{ overview: <p>overview panel</p>, sets: <p>sets panel</p>, members: <p>members panel</p> }}
      />,
    )
    expect(screen.getByRole('tab', { name: /sets/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('sets panel').closest('[role=tabpanel]')).toHaveProperty('hidden', false)
    expect(screen.getByText('overview panel').closest('[role=tabpanel]')).toHaveProperty('hidden', true)
    fireEvent.click(screen.getByRole('tab', { name: /members/i }))
    expect(screen.getByText('members panel').closest('[role=tabpanel]')).toHaveProperty('hidden', false)
    fireEvent.keyDown(screen.getByRole('tab', { name: /members/i }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /overview/i }).getAttribute('aria-selected')).toBe('true')
  })
})
