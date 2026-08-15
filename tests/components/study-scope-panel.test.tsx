// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

/**
 * Spec 3C §6. Three properties, each of which fails silently if untested:
 * the reveal (a list that never appears makes the setting unusable), the
 * blocked empty save (which would store the OPPOSITE of what the panel shows,
 * since `[]` means everything), and the one-field payload (Spec 3B §5's
 * partial-save contract, now at four panels).
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

describe('StudyScopePanel: the reveal', () => {
  it('hides the set list until the box is ticked', async () => {
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain sets'))

    expect(screen.queryByText('Accounting Interview Prep')).toBeNull()
    fireEvent.click(screen.getByText('Only test certain sets'))
    expect(screen.getByText('Accounting Interview Prep')).toBeTruthy()
  })

  it('hides the category list until its own box is ticked, independently', async () => {
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain sets'))

    fireEvent.click(screen.getByText('Only test certain sets'))
    // Sets revealed must not reveal categories — they are two separate toggles.
    expect(screen.queryByText('accounting')).toBeNull()

    fireEvent.click(screen.getByText('Only test certain categories'))
    expect(screen.getByText('accounting')).toBeTruthy()
  })

  it('offers Uncategorized as a real bucket', async () => {
    // The only option available to a learner with no categories — which is the
    // library shape the 3B live gate actually found.
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain categories'))
    fireEvent.click(screen.getByText('Only test certain categories'))
    expect(screen.getByText('Uncategorized')).toBeTruthy()
  })

  it('starts ticked and populated when a scope is already stored', async () => {
    h.loadTuning.mockResolvedValue(tuning({ setIds: ['set-a'], categoryKeys: [] }))
    render(<StudyScopePanel />)
    // Derived from the stored value: a non-empty list is the only thing
    // "limited" can mean, so there is no separate flag to fall out of sync.
    await waitFor(() => expect(screen.getByText('Accounting Interview Prep')).toBeTruthy())
  })
})

describe('StudyScopePanel: the un-savable state', () => {
  it('blocks the save when a box is ticked with nothing selected', async () => {
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain sets'))

    fireEvent.click(screen.getByText('Only test certain sets'))
    // `[]` on disk means EVERYTHING, so storing this state would persist the
    // exact opposite of what the screen claims.
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Pick at least one set/)).toBeTruthy()

    fireEvent.click(screen.getByText('Only test certain sets'))
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('re-enables the save once something is picked', async () => {
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain sets'))

    fireEvent.click(screen.getByText('Only test certain sets'))
    fireEvent.click(screen.getByText('Accounting Interview Prep'))
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('blocks on an empty CATEGORY group even when the set group is valid', async () => {
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain sets'))

    fireEvent.click(screen.getByText('Only test certain sets'))
    fireEvent.click(screen.getByText('Accounting Interview Prep'))
    fireEvent.click(screen.getByText('Only test certain categories'))

    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('StudyScopePanel: the payload', () => {
  it('sends ONLY studyScope, never the fields it loaded', async () => {
    // The Spec 3B §5 invariant at four panels. This panel loads bands,
    // thresholds and strategy along with its own field; echoing any of them
    // back is the read-modify-write clobber partial saves exist to prevent.
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain sets'))

    fireEvent.click(screen.getByText('Only test certain sets'))
    fireEvent.click(screen.getByText('Accounting Interview Prep'))
    fireEvent.click(saveButton())
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    const payload = h.saveTuning.mock.calls[0][0]
    expect(Object.keys(payload)).toEqual(['studyScope'])
    expect(payload.studyScope).toEqual({ setIds: ['set-a'], categoryKeys: [] })
  })

  it('sends an EMPTY dimension when its box is unticked, not the stale selection', async () => {
    // Unticking must clear. Sending the last selection because it is still in
    // React state would make "use every set" impossible to express again.
    h.loadTuning.mockResolvedValue(tuning({ setIds: ['set-a'], categoryKeys: ['accounting'] }))
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Accounting Interview Prep'))

    fireEvent.click(screen.getByText('Only test certain sets'))
    fireEvent.click(saveButton())
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    expect(h.saveTuning.mock.calls[0][0].studyScope).toEqual({
      setIds: [],
      categoryKeys: ['accounting'],
    })
  })

  it('stores the Uncategorized sentinel by key', async () => {
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain categories'))

    fireEvent.click(screen.getByText('Only test certain categories'))
    fireEvent.click(screen.getByText('Uncategorized'))
    fireEvent.click(saveButton())
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    expect(h.saveTuning.mock.calls[0][0].studyScope.categoryKeys).toEqual([UNCATEGORIZED_ID])
  })

  it('stores categories by cross-set key, never by per-set id', async () => {
    // A CardCategory row is set-scoped, so storing `c1` would mean one set's
    // accounting only — the asymmetry the Prisma comment exists to protect.
    render(<StudyScopePanel />)
    await waitFor(() => screen.getByText('Only test certain categories'))

    fireEvent.click(screen.getByText('Only test certain categories'))
    fireEvent.click(screen.getByText('accounting'))
    fireEvent.click(saveButton())
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    expect(h.saveTuning.mock.calls[0][0].studyScope.categoryKeys).toEqual(['accounting'])
  })
})
