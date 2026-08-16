// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ScopeLine, { scopeChips, MAX_VISIBLE_CHIPS } from '@/components/memory/ScopeLine'
import { triggerLabel } from '@/components/ui/multi-select'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'
import type { HistoryScope } from '@/lib/memory/scope'

afterEach(cleanup)

const OPTIONS = {
  sets: [
    { id: 's1', title: 'Accounting' },
    { id: 's2', title: 'Valuation' },
  ],
  categories: [
    { key: 'dcf', name: 'DCF', color: '#f00', setIds: ['s1'], categoryIds: ['c1'], cardCount: 4 },
  ],
  cards: [{ id: 'card1', term: 'WACC' }],
}

const EMPTY: HistoryScope = { setIds: [], categoryKeys: [] }

describe('scopeChips', () => {
  it('renders one chip per active narrowing, across both dimensions', () => {
    const chips = scopeChips(
      { setIds: ['s1'], categoryKeys: ['dcf'] },
      OPTIONS,
      () => {},
    )
    expect(chips.map((c) => c.label)).toEqual(['Accounting', 'DCF'])
  })

  it('pins the card chip so the overflow cap can never swallow it', () => {
    // cardId is the narrowest scope and subsumes set/category in
    // buildStudyEventWhere. The first implementation just put it last and
    // sliced — which drops it as soon as there are MAX_VISIBLE_CHIPS other
    // narrowings, leaving the learner on one card's history with nothing on
    // screen saying so.
    const chips = scopeChips(
      { setIds: ['s1', 's2'], categoryKeys: ['dcf'], cardId: 'card1' },
      OPTIONS,
      () => {},
    )
    const card = chips.find((c) => c.label === 'Card: WACC')
    expect(card?.pinned).toBe(true)
    // Nothing else is exempt, or the cap would mean nothing.
    expect(chips.filter((c) => c.pinned)).toHaveLength(1)
  })

  it('surfaces a deleted category under its raw key rather than dropping it', () => {
    // A scope from a bookmarked URL can name a category that was since renamed
    // or merged. A chip that vanishes is a filter the learner cannot clear.
    const chips = scopeChips({ ...EMPTY, categoryKeys: ['ghost'] }, OPTIONS, () => {})
    expect(chips[0].label).toBe('ghost (removed)')
  })

  it('names the uncategorized sentinel, not its raw id', () => {
    const chips = scopeChips({ ...EMPTY, categoryKeys: [UNCATEGORIZED_ID] }, OPTIONS, () => {})
    expect(chips[0].label).toBe('Uncategorized')
  })

  it('clears the card when the set carrying it is removed', () => {
    // The card filter was only ever meaningful inside a single set; leaving it
    // behind would apply a narrowing with nothing on screen explaining it.
    const onChange = vi.fn()
    const chips = scopeChips(
      { setIds: ['s1'], categoryKeys: [], cardId: 'card1' },
      OPTIONS,
      onChange,
    )
    chips.find((c) => c.key === 'set:s1')!.onRemove()
    expect(onChange).toHaveBeenCalledWith({ setIds: [], categoryKeys: [], cardId: undefined })
  })

  it('removes only the chip asked for', () => {
    const onChange = vi.fn()
    const chips = scopeChips(
      { setIds: ['s1', 's2'], categoryKeys: ['dcf'] },
      OPTIONS,
      onChange,
    )
    chips.find((c) => c.key === 'set:s1')!.onRemove()
    expect(onChange.mock.calls[0][0].setIds).toEqual(['s2'])
    expect(onChange.mock.calls[0][0].categoryKeys).toEqual(['dcf'])
  })
})

describe('triggerLabel: the scope is legible without opening anything', () => {
  const opts = [
    { value: 's1', label: 'Accounting' },
    { value: 's2', label: 'Valuation' },
  ]

  it('says "All X" when nothing is selected', () => {
    expect(triggerLabel([], opts, 'sets', 'All sets')).toBe('All sets')
  })

  it('names a single selection instead of counting it', () => {
    expect(triggerLabel(['s1'], opts, 'sets', 'All sets')).toBe('Accounting')
  })

  it('counts a multi-selection instead of listing it', () => {
    expect(triggerLabel(['s1', 's2'], opts, 'sets', 'All sets')).toBe('2 sets')
  })

  it('falls back to the raw key when the option no longer exists', () => {
    // Blank would read as "no filter" while a filter is very much applied.
    expect(triggerLabel(['gone'], opts, 'sets', 'All sets')).toBe('gone')
  })
})

describe('ScopeLine caps the chip list', () => {
  it('collapses the surplus into a count rather than wrapping forever', () => {
    const many = {
      sets: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, title: `Set ${i}` })),
      categories: [],
      cards: [],
    }
    render(
      <ScopeLine
        options={many}
        scope={{ setIds: many.sets.map((s) => s.id), categoryKeys: [] }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText(`+${8 - MAX_VISIBLE_CHIPS} more`)).toBeTruthy()
    // The trigger still reports the true total, so the cap never misleads.
    expect(screen.getByText('8 sets')).toBeTruthy()
  })

  it('still shows the card chip when the cap is already full', () => {
    // The regression the `pinned` flag exists for. Eight sets fill the cap
    // several times over; the card narrowing must survive anyway.
    const many = {
      sets: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, title: `Set ${i}` })),
      categories: [],
      cards: [{ id: 'card1', term: 'WACC' }],
    }
    render(
      <ScopeLine
        options={many}
        scope={{ setIds: many.sets.map((s) => s.id), categoryKeys: [], cardId: 'card1' }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('Card: WACC')).toBeTruthy()
    // The overflow count reports the hidden SETS only — the pinned chip is not
    // hidden, so counting it would overstate what was collapsed.
    expect(screen.getByText(`+${8 - MAX_VISIBLE_CHIPS} more`)).toBeTruthy()
  })

  it('offers Clear only when something is actually scoped', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ScopeLine options={OPTIONS} scope={EMPTY} onChange={onChange} />,
    )
    expect(screen.queryByText('Clear')).toBeNull()

    rerender(
      <ScopeLine
        options={OPTIONS}
        scope={{ setIds: ['s1'], categoryKeys: [] }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('Clear'))
    expect(onChange).toHaveBeenCalledWith({ setIds: [], categoryKeys: [] })
  })
})
