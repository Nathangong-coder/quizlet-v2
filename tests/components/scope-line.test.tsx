// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ScopeLine, {
  scopeChips,
  activityOptions,
  MAX_VISIBLE_CHIPS,
} from '@/components/memory/ScopeLine'
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

const EMPTY: HistoryScope = { setIds: [], categoryKeys: [], sources: [] }

describe('scopeChips', () => {
  it('renders one chip per active narrowing, across both dimensions', () => {
    const chips = scopeChips(
      { ...EMPTY, setIds: ['s1'], categoryKeys: ['dcf'] },
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
      { ...EMPTY, setIds: ['s1', 's2'], categoryKeys: ['dcf'], cardId: 'card1' },
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
      { ...EMPTY, setIds: ['s1'], categoryKeys: [], cardId: 'card1' },
      OPTIONS,
      onChange,
    )
    chips.find((c) => c.key === 'set:s1')!.onRemove()
    expect(onChange).toHaveBeenCalledWith({
      setIds: [],
      categoryKeys: [],
      sources: [],
      cardId: undefined,
    })
  })

  it('removes only the chip asked for', () => {
    const onChange = vi.fn()
    const chips = scopeChips(
      { ...EMPTY, setIds: ['s1', 's2'], categoryKeys: ['dcf'] },
      OPTIONS,
      onChange,
    )
    chips.find((c) => c.key === 'set:s1')!.onRemove()
    expect(onChange.mock.calls[0][0].setIds).toEqual(['s2'])
    expect(onChange.mock.calls[0][0].categoryKeys).toEqual(['dcf'])
  })
})

describe('activityOptions', () => {
  it('lists the four graded question modes before the rest', () => {
    expect(activityOptions().map((o) => o.value)).toEqual([
      'quiz-mc',
      'quiz-sa',
      'quiz-tf',
      'matching',
      'review',
      'lesson',
    ])
  })

  it('splits the two groups with exactly one divider, on the first non-question', () => {
    const opts = activityOptions()
    expect(opts.filter((o) => o.dividerBefore).map((o) => o.value)).toEqual(['review'])
  })

  it('offers every mode even at zero, so an option never vanishes', () => {
    // Data-driven options — what the by-mode chips did — meant a mode you had
    // not tried yet was simply absent, which reads as a broken filter rather
    // than an empty shelf.
    const opts = activityOptions({ 'quiz-mc': 42 })
    expect(opts).toHaveLength(6)
    expect(opts.find((o) => o.value === 'quiz-mc')?.count).toBe(42)
    expect(opts.find((o) => o.value === 'lesson')?.count).toBe(0)
  })

  it('labels each option with its short name', () => {
    const labels = activityOptions().map((o) => o.label)
    expect(labels).toContain('Multiple Choice')
    expect(labels).toContain('Matching')
    expect(labels).not.toContain('Matching Game')
  })
})

describe('ScopeLine activity picker is opt-in per surface', () => {
  it('renders the picker when a surface asks for it', () => {
    render(
      <ScopeLine options={OPTIONS} scope={EMPTY} onChange={() => {}} activityFilter={{}} />,
    )
    expect(screen.getByText('All activity')).toBeTruthy()
  })

  it('renders NO picker without it — the learner dashboard must not filter by mode', () => {
    // Narrowing a knowledge model to one answer mode silently halves every
    // posterior it touches, so that page deliberately omits the prop.
    render(<ScopeLine options={OPTIONS} scope={EMPTY} onChange={() => {}} />)
    expect(screen.queryByText('All activity')).toBeNull()
  })

  it('reports a selected source on the trigger and as a removable chip', () => {
    const onChange = vi.fn()
    render(
      <ScopeLine
        options={OPTIONS}
        scope={{ ...EMPTY, sources: ['quiz-sa'] }}
        onChange={onChange}
        activityFilter={{}}
      />,
    )
    // Both the collapsed trigger and the chip row name it, so the filter is
    // legible whether or not the menu is open.
    expect(screen.getAllByText('Short Answer').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByLabelText('Remove Short Answer from scope'))
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, sources: [] })
  })

  it('counts a source scope as a narrowing, so Clear is offered', () => {
    render(
      <ScopeLine
        options={OPTIONS}
        scope={{ ...EMPTY, sources: ['review'] }}
        onChange={() => {}}
        activityFilter={{}}
      />,
    )
    expect(screen.getByText('Clear')).toBeTruthy()
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
        scope={{ ...EMPTY, setIds: many.sets.map((s) => s.id) }}
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
        scope={{ ...EMPTY, setIds: many.sets.map((s) => s.id), cardId: 'card1' }}
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
        scope={{ ...EMPTY, setIds: ['s1'] }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('Clear'))
    expect(onChange).toHaveBeenCalledWith({ setIds: [], categoryKeys: [], sources: [] })
  })
})
