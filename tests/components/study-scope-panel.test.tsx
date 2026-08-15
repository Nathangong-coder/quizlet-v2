// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

/**
 * Spec 3C §6, revised by the 2026-08-15 scope redesign.
 *
 * The panel's "Only test certain sets" checkboxes are GONE, and with them the
 * reveal and the blocked-empty-save this file used to cover. That behaviour was
 * removed deliberately, not broken: `[]` on disk already means EVERYTHING, so
 * ticked-and-empty had no representation and the panel had to detect it and
 * refuse to save. A control whose only additional state is invalid should not
 * exist.
 *
 * What still matters, and is covered here:
 *  - empty means everything, and saves as `[]` rather than being blocked;
 *  - the one-field payload (Spec 3B §5's partial-save contract, four panels on);
 *  - categories store the cross-set key, never a per-set id.
 */

// vitest.config.ts has no `globals: true`, so RTL never registers auto-cleanup.
afterEach(cleanup)

const h = vi.hoisted(() => ({
  loadTuning: vi.fn(),
  saveTuning: vi.fn(),
  listMemoryFilterOptions: vi.fn(),
}))

// Both are 'use server' modules: importing them for real drags next-auth into
// jsdom and the file dies at load with "Cannot find module next/server".
vi.mock('@/actions/learner-tuning', () => ({
  loadTuning: h.loadTuning,
  saveTuning: h.saveTuning,
}))
vi.mock('@/actions/memory', () => ({
  listMemoryFilterOptions: h.listMemoryFilterOptions,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import StudyScopePanel from '@/components/settings/StudyScopePanel'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'

const OPTIONS = {
  sets: [
    { id: 'set-a', title: 'Accounting Interview Prep' },
    { id: 'set-b', title: 'Valuation Deck' },
  ],
  categories: [
    { key: 'accounting', name: 'accounting', color: '#f00', setIds: ['set-a'], categoryIds: ['c1'], cardCount: 12 },
    { key: 'valuation', name: 'valuation', color: '#0f0', setIds: ['set-b'], categoryIds: ['c2'], cardCount: 7 },
  ],
  cards: [],
}

const EMPTY_SCOPE = { setIds: [], categoryKeys: [] }

function tuning(studyScope: { setIds: string[]; categoryKeys: string[] }) {
  return {
    success: true,
    data: {
      strategy: 'balanced',
      bandOverrides: { inversion: [1, 2] },
      thresholdOverrides: { minObservations: 1 },
      studyScope,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadTuning.mockResolvedValue(tuning(EMPTY_SCOPE))
  h.saveTuning.mockResolvedValue(tuning(EMPTY_SCOPE))
  h.listMemoryFilterOptions.mockResolvedValue({ success: true, data: OPTIONS })
})

const saveButton = () => screen.getByText('Save study scope')
// Once a set is chosen the TRIGGER shows its name too, so a bare text query is
// ambiguous. The options inside the popover are the only checkboxes.
const option = (name: string) => screen.getByRole('checkbox', { name })
const openSets = async () => {
  fireEvent.click(await screen.findByText('All sets'))
  return screen.findByRole('checkbox', { name: 'Accounting Interview Prep' })
}
const openCategories = async () => {
  fireEvent.click(await screen.findByText('All categories'))
  return screen.findByRole('checkbox', { name: 'accounting' })
}

describe('StudyScopePanel: empty means everything', () => {
  it('shows both dimensions collapsed and unrestricted by default', async () => {
    render(<StudyScopePanel />)
    // The trigger states the scope without being opened — the whole point of
    // collapsing it.
    expect(await screen.findByText('All sets')).toBeTruthy()
    expect(screen.getByText('All categories')).toBeTruthy()
    expect(screen.getByText('Using your whole library.')).toBeTruthy()
  })

  it('never blocks the save, because there is no un-savable state left', async () => {
    render(<StudyScopePanel />)
    await screen.findByText('All sets')
    // The old panel disabled this whenever a box was ticked with nothing
    // picked. That state cannot be expressed now.
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(h.saveTuning).toHaveBeenCalledWith({ studyScope: { setIds: [], categoryKeys: [] } }),
    )
  })

  it('reflects a stored scope on the trigger without being opened', async () => {
    h.loadTuning.mockResolvedValue(tuning({ setIds: ['set-a'], categoryKeys: [] }))
    render(<StudyScopePanel />)
    await waitFor(() => expect(screen.getByText('Accounting Interview Prep')).toBeTruthy())
    expect(screen.getByText('Recommendations and prefills will use this slice of your library.')).toBeTruthy()
  })

  it('summarises a multi-selection by count rather than listing it', async () => {
    h.loadTuning.mockResolvedValue(tuning({ setIds: ['set-a', 'set-b'], categoryKeys: [] }))
    render(<StudyScopePanel />)
    await waitFor(() => expect(screen.getByText('2 sets')).toBeTruthy())
  })
})

describe('StudyScopePanel: the payload', () => {
  it('sends ONLY studyScope, never the fields it loaded', async () => {
    // Spec 3B §5: `saveTuning` leaves absent fields unchanged. Sending the
    // loaded strategy/bands/thresholds back would make this panel clobber the
    // other three whenever they were edited in another tab.
    render(<StudyScopePanel />)
    await openSets()
    fireEvent.click(option('Accounting Interview Prep'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())
    const payload = h.saveTuning.mock.calls[0][0]
    expect(Object.keys(payload)).toEqual(['studyScope'])
    expect(payload.studyScope.setIds).toEqual(['set-a'])
  })

  it('stores categories by cross-set key, never by per-set id', async () => {
    // A CardCategory row is set-scoped, so an id would mean one set's
    // "accounting" only. `normalizedName` is what spans sets.
    render(<StudyScopePanel />)
    await openCategories()
    fireEvent.click(option('accounting'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())
    const { categoryKeys } = h.saveTuning.mock.calls[0][0].studyScope
    expect(categoryKeys).toEqual(['accounting'])
    expect(categoryKeys).not.toContain('c1')
  })

  it('stores the Uncategorized sentinel by key', async () => {
    render(<StudyScopePanel />)
    await openCategories()
    fireEvent.click(option('Uncategorized'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())
    expect(h.saveTuning.mock.calls[0][0].studyScope.categoryKeys).toEqual([UNCATEGORIZED_ID])
  })

  it('drops a selection that is toggled back off', async () => {
    render(<StudyScopePanel />)
    await openSets()
    fireEvent.click(option('Accounting Interview Prep'))
    fireEvent.click(option('Accounting Interview Prep'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())
    expect(h.saveTuning.mock.calls[0][0].studyScope.setIds).toEqual([])
  })
})
