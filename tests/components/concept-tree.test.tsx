// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { ConceptTree } from '@/components/klt/ConceptTree'

// RTL's auto-cleanup between tests relies on a global `afterEach`, which
// this repo doesn't register (vitest.config.ts has no `globals: true`) —
// without this, one test's rendered DOM bleeds into the next test's queries.
afterEach(cleanup)

// Mocks otherwise carry call history across tests in this file (vi.fn()
// instances from vi.mock persist for the whole file), which would let an
// earlier test's applySkeleton/mergeConcepts call bleed into a later test's
// ".not.toHaveBeenCalled()" assertion.
beforeEach(() => {
  vi.clearAllMocks()
  // Default: no presets saved. Individual tests override this when the
  // preset picker's contents matter.
  mockListPresets.mockResolvedValue({ success: true, data: [] })
})

/**
 * `getByText('finance')` alone is ambiguous the moment a second node exists:
 * every OTHER row's "Move under"/"Merge into" `<select>` offers 'finance' as
 * a candidate `<option>`, and RTL's text matcher matches option text nodes
 * too. Scoping to the row-title `<p>` is what makes "find this row" reliable.
 */
function rowFor(name: string): HTMLElement {
  return screen.getByText(name, { selector: 'p.font-medium' }).closest('[data-node-id]') as HTMLElement
}

// Both action modules are 'use server'. Importing either for real drags
// next-auth into jsdom and the whole file fails to load with "Cannot find
// module next/server" — before any test runs. See tests/components/QuizSummary.test.tsx.
vi.mock('@/actions/klt-tree', () => ({
  listConceptTree: vi.fn(),
  createConcept: vi.fn(),
  reparentConcept: vi.fn(),
  renameConcept: vi.fn(),
  mergeConcepts: vi.fn(),
  deleteConcept: vi.fn(),
}))
vi.mock('@/actions/klt-seed', () => ({
  suggestSkeleton: vi.fn(),
  applySkeleton: vi.fn(),
}))
vi.mock('@/actions/klt-presets', () => ({
  listPresets: vi.fn(),
  applyPreset: vi.fn(),
  savePresetFromSet: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  listConceptTree,
  createConcept,
  reparentConcept,
  renameConcept,
  mergeConcepts,
  deleteConcept,
} from '@/actions/klt-tree'
import { suggestSkeleton, applySkeleton } from '@/actions/klt-seed'
import { listPresets, applyPreset, savePresetFromSet } from '@/actions/klt-presets'

// Typed handles rather than `as any`, matching this repo's convention (see
// QuizSummary.test.tsx's "canReset opt-in" block) — `any` here is a
// no-explicit-any lint error and would raise the lint baseline.
const mockListConceptTree = listConceptTree as unknown as ReturnType<typeof vi.fn>
const mockCreateConcept = createConcept as unknown as ReturnType<typeof vi.fn>
const mockReparentConcept = reparentConcept as unknown as ReturnType<typeof vi.fn>
const mockRenameConcept = renameConcept as unknown as ReturnType<typeof vi.fn>
const mockMergeConcepts = mergeConcepts as unknown as ReturnType<typeof vi.fn>
const mockDeleteConcept = deleteConcept as unknown as ReturnType<typeof vi.fn>
const mockSuggestSkeleton = suggestSkeleton as unknown as ReturnType<typeof vi.fn>
const mockApplySkeleton = applySkeleton as unknown as ReturnType<typeof vi.fn>
const mockListPresets = listPresets as unknown as ReturnType<typeof vi.fn>
const mockApplyPreset = applyPreset as unknown as ReturnType<typeof vi.fn>
const mockSavePresetFromSet = savePresetFromSet as unknown as ReturnType<typeof vi.fn>

const SET_ID = 'set-1'
const SET_TITLE = 'Finance 101'

interface NodeOverrides {
  id: string
  kltId?: string
  name: string
  parentKltId?: string | null
  depth?: number
  ancestorIds?: string[]
  linkCount?: number
  childCount?: number
}

function node(o: NodeOverrides) {
  return {
    id: o.id,
    kltId: o.kltId ?? o.id,
    name: o.name,
    normalizedName: o.name,
    parentKltId: o.parentKltId ?? null,
    depth: o.depth ?? 0,
    ancestorIds: o.ancestorIds ?? [],
    linkCount: o.linkCount ?? 0,
    childCount: o.childCount ?? 0,
  }
}

function unplaced(kltId: string, name: string, linkCount = 1) {
  return { kltId, name, normalizedName: name, linkCount }
}

function mockTree(nodes: ReturnType<typeof node>[], unplacedList: ReturnType<typeof unplaced>[] = []) {
  mockListConceptTree.mockResolvedValue({
    success: true,
    data: { setId: SET_ID, setTitle: SET_TITLE, nodes, unplaced: unplacedList },
  })
}

function renderTree(isAdmin = false) {
  return render(<ConceptTree setId={SET_ID} setTitle={SET_TITLE} isAdmin={isAdmin} />)
}

describe('ConceptTree', () => {
  it('renders the tree indented by depth', async () => {
    mockTree([node({ id: 'f', name: 'finance', depth: 0 }), node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] })])

    renderTree()

    const financeRow = await waitFor(() => rowFor('finance'))
    const accountingRow = rowFor('accounting')
    expect(financeRow.getAttribute('data-depth')).toBe('0')
    expect(accountingRow.getAttribute('data-depth')).toBe('1')
  })

  it("disables Delete for a node with children, and says why", async () => {
    mockTree([
      node({ id: 'f', name: 'finance', depth: 0, childCount: 1 }),
      node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
    ])

    renderTree()
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    expect(within(financeRow).getByRole('button', { name: /^delete$/i })).toBeDisabled()
    expect(within(financeRow).getByText(/has 1 child/i)).toBeInTheDocument()

    const accountingRow = rowFor('accounting')
    expect(within(accountingRow).getByRole('button', { name: /^delete$/i })).not.toBeDisabled()
  })

  it('does not offer a node itself as its own new parent, nor a descendant of itself', async () => {
    mockTree([
      node({ id: 'f', name: 'finance', depth: 0 }),
      node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
      node({ id: 'v', name: 'valuation', depth: 0 }),
    ])

    renderTree()
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const moveSelect = within(financeRow).getByLabelText(/move finance under/i) as HTMLSelectElement
    const optionLabels = Array.from(moveSelect.options).map((o) => o.textContent)

    expect(optionLabels).not.toContain('finance')
    expect(optionLabels).not.toContain('accounting')
    expect(optionLabels).toContain('valuation')
  })

  it('moving a node shows an impact preview, and only calls reparentConcept after confirming', async () => {
    // finance(root) -> accounting -> ratios. Moving 'accounting' under
    // 'valuation' moves it AND its child 'ratios': 2 concepts.
    mockTree([
      node({ id: 'f', name: 'finance', depth: 0 }),
      node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
      node({ id: 'r', name: 'ratios', parentKltId: 'a', depth: 2, ancestorIds: ['f', 'a'] }),
      node({ id: 'v', name: 'valuation', depth: 0 }),
    ])
    mockReparentConcept.mockResolvedValue({ success: true, data: null })

    renderTree()
    await waitFor(() => rowFor('accounting'))

    const accountingRow = rowFor('accounting')
    const moveSelect = within(accountingRow).getByLabelText(/move accounting under/i)
    fireEvent.change(moveSelect, { target: { value: 'v' } })

    expect(mockReparentConcept).not.toHaveBeenCalled()
    await waitFor(() => within(accountingRow).getByText(/moves 2 concepts/i))

    fireEvent.click(within(accountingRow).getByRole('button', { name: /confirm move/i }))
    await waitFor(() => expect(mockReparentConcept).toHaveBeenCalledWith(SET_ID, 'a', 'v'))
  })

  it('moving a node calls reparentConcept with null for "(make a root)", after confirming', async () => {
    mockTree([
      node({ id: 'f', name: 'finance', depth: 0 }),
      node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
    ])
    mockReparentConcept.mockResolvedValue({ success: true, data: null })

    renderTree()
    await waitFor(() => rowFor('accounting'))

    const accountingRow = rowFor('accounting')
    const moveSelect = within(accountingRow).getByLabelText(/move accounting under/i)
    fireEvent.change(moveSelect, { target: { value: '' } })

    fireEvent.click(await within(accountingRow).findByRole('button', { name: /confirm move/i }))
    await waitFor(() => expect(mockReparentConcept).toHaveBeenCalledWith(SET_ID, 'a', null))
  })

  it('renames a node via the inline input, keyed on kltId not the row id', async () => {
    mockTree([node({ id: 'row-f', kltId: 'klt-f', name: 'finance', depth: 0 })])
    mockRenameConcept.mockResolvedValue({ success: true, data: null })

    renderTree()
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const renameInput = within(financeRow).getByLabelText(/rename finance/i)
    fireEvent.change(renameInput, { target: { value: 'financial statements' } })
    fireEvent.click(within(financeRow).getByRole('button', { name: /^rename$/i }))

    await waitFor(() => expect(mockRenameConcept).toHaveBeenCalledWith(SET_ID, 'klt-f', 'financial statements'))
  })

  it('deleting a childless node calls deleteConcept with the concept id, not the row id', async () => {
    mockTree([node({ id: 'row-f', kltId: 'klt-f', name: 'finance', depth: 0, childCount: 0 })])
    mockDeleteConcept.mockResolvedValue({ success: true, data: null })

    renderTree()
    await waitFor(() => rowFor('finance'))

    fireEvent.click(within(rowFor('finance')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mockDeleteConcept).toHaveBeenCalledWith(SET_ID, 'klt-f'))
  })

  it('requires a confirm before merging, since merge deletes the source', async () => {
    mockTree([node({ id: 'f', name: 'finance', depth: 0 }), node({ id: 'v', name: 'valuation', depth: 0 })])
    mockMergeConcepts.mockResolvedValue({ success: true, data: null })

    renderTree()
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const mergeSelect = within(financeRow).getByLabelText(/merge finance into/i) as HTMLSelectElement
    fireEvent.change(mergeSelect, { target: { value: 'v' } })

    expect(mockMergeConcepts).not.toHaveBeenCalled()
    await waitFor(() => screen.getByRole('button', { name: /confirm merge/i }))

    fireEvent.click(screen.getByRole('button', { name: /confirm merge/i }))
    await waitFor(() => expect(mockMergeConcepts).toHaveBeenCalledWith(SET_ID, 'f', 'v'))
  })

  it('canceling the merge confirm never calls mergeConcepts', async () => {
    mockTree([node({ id: 'f', name: 'finance', depth: 0 }), node({ id: 'v', name: 'valuation', depth: 0 })])

    renderTree()
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const mergeSelect = within(financeRow).getByLabelText(/merge finance into/i) as HTMLSelectElement
    fireEvent.change(mergeSelect, { target: { value: 'v' } })

    await waitFor(() => screen.getByRole('button', { name: /cancel merge/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel merge/i }))

    expect(mockMergeConcepts).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /confirm merge/i })).not.toBeInTheDocument()
  })

  it('adding a root concept calls createConcept with a null parent', async () => {
    mockTree([node({ id: 'f', name: 'finance', depth: 0 })])
    mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'new' } })

    renderTree()
    await waitFor(() => rowFor('finance'))

    fireEvent.change(screen.getByLabelText(/new root concept name/i), { target: { value: 'macro' } })
    fireEvent.click(screen.getByRole('button', { name: /add root concept/i }))

    await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'macro', null))
  })

  it('adding a child concept from a row calls createConcept with that row’s kltId as parent', async () => {
    mockTree([node({ id: 'row-f', kltId: 'klt-f', name: 'finance', depth: 0 })])
    mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'new' } })

    renderTree()
    await waitFor(() => rowFor('finance'))

    fireEvent.click(within(rowFor('finance')).getByRole('button', { name: /add child/i }))
    fireEvent.change(await screen.findByLabelText(/new concept under finance/i), { target: { value: 'accounting' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'accounting', 'klt-f'))
  })

  describe('unplaced concepts', () => {
    it('render in their own section, first, with a count', async () => {
      mockTree(
        [node({ id: 'f', name: 'finance', depth: 0 })],
        [unplaced('u1', 'quick ratio', 3)],
      )

      renderTree()
      await waitFor(() => screen.getByText(/unplaced concepts \(1\)/i))
      expect(screen.getByText('quick ratio')).toBeInTheDocument()
      expect(screen.getByText(/3 links/i)).toBeInTheDocument()
    })

    it('do not render a section at all when there are none', async () => {
      mockTree([node({ id: 'f', name: 'finance', depth: 0 })], [])
      renderTree()
      await waitFor(() => rowFor('finance'))
      expect(screen.queryByText(/unplaced concepts/i)).not.toBeInTheDocument()
    })

    it('offers a "Place under" control that calls createConcept with the unplaced concept\'s own name', async () => {
      mockTree(
        [node({ id: 'f', name: 'finance', depth: 0 })],
        [unplaced('u1', 'quick ratio', 3)],
      )
      mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'u1' } })

      renderTree()
      await waitFor(() => screen.getByText(/unplaced concepts \(1\)/i))

      const placeSelect = screen.getByLabelText(/place quick ratio under/i)
      fireEvent.change(placeSelect, { target: { value: 'f' } })
      fireEvent.click(screen.getByRole('button', { name: /^place$/i }))

      await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'quick ratio', 'f'))
    })

    it('"Place under" defaults to root ("make a root") for the parent', async () => {
      mockTree(
        [node({ id: 'f', name: 'finance', depth: 0 })],
        [unplaced('u1', 'quick ratio', 3)],
      )
      mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'u1' } })

      renderTree()
      await waitFor(() => screen.getByText(/unplaced concepts \(1\)/i))
      fireEvent.click(screen.getByRole('button', { name: /^place$/i }))

      await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'quick ratio', null))
    })
  })

  describe('filter', () => {
    it('narrows to matching concepts and keeps their ancestors visible', async () => {
      mockTree([
        node({ id: 'f', name: 'finance', depth: 0 }),
        node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
        node({ id: 'r', name: 'ratios', parentKltId: 'a', depth: 2, ancestorIds: ['f', 'a'] }),
        node({ id: 'v', name: 'valuation', depth: 0 }),
      ])

      renderTree()
      await waitFor(() => rowFor('finance'))

      fireEvent.change(screen.getByLabelText(/filter concepts/i), { target: { value: 'ratios' } })

      await waitFor(() => expect(screen.queryByText('ratios', { selector: 'p.font-medium' })).toBeInTheDocument())
      // Ancestors of the match stay visible for context…
      expect(screen.queryByText('finance', { selector: 'p.font-medium' })).toBeInTheDocument()
      expect(screen.queryByText('accounting', { selector: 'p.font-medium' })).toBeInTheDocument()
      // …but an unrelated branch is filtered out.
      expect(screen.queryByText('valuation', { selector: 'p.font-medium' })).not.toBeInTheDocument()
    })
  })

  describe('empty-structure panel', () => {
    it('appears when the set has no placed nodes at all', async () => {
      mockTree([], [])
      renderTree()
      await waitFor(() => screen.getByText(/no concepts yet/i))
    })

    it('appears, phrased "no structure yet", when concepts exist but none is placed', async () => {
      mockTree([], [unplaced('u1', 'quick ratio')])
      renderTree()
      await waitFor(() => screen.getByText(/no structure yet/i))
    })

    it('does not appear once at least one concept is placed', async () => {
      mockTree([node({ id: 'f', name: 'finance', depth: 0 })])
      renderTree()
      await waitFor(() => rowFor('finance'))
      expect(screen.queryByText(/no concepts yet/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/no structure yet/i)).not.toBeInTheDocument()
    })

    it('offers the AI-seam alongside manual entry, prefilling the subject from setTitle', async () => {
      mockTree([], [])
      renderTree()
      await waitFor(() => screen.getByText(/no concepts yet/i))
      expect(screen.getByLabelText(/subject/i)).toHaveValue(SET_TITLE)
    })

    it('offers a real preset picker, disabled with no selection until presets load', async () => {
      mockTree([], [])
      mockListPresets.mockResolvedValue({
        success: true,
        data: [{ id: 'p1', name: 'Finance skeleton', pathCount: 2 }],
      })
      renderTree()
      await waitFor(() => screen.getByText(/no concepts yet/i))
      await waitFor(() => screen.getByLabelText(/^preset$/i))
      expect(screen.getByRole('button', { name: /apply preset/i })).toBeDisabled()
    })

    it('says so when no presets have been saved yet', async () => {
      mockTree([], [])
      renderTree()
      await waitFor(() => screen.getByText(/no concepts yet/i))
      await waitFor(() => screen.getByText(/no presets saved yet/i))
    })

    it('applying a preset calls applyPreset with the chosen id and this set, then reloads', async () => {
      mockTree([], [])
      mockListPresets.mockResolvedValue({
        success: true,
        data: [{ id: 'p1', name: 'Finance skeleton', pathCount: 2 }],
      })
      mockApplyPreset.mockResolvedValue({ success: true, data: { created: 2, skipped: 0 } })
      renderTree()
      await waitFor(() => screen.getByText(/no concepts yet/i))

      fireEvent.change(await screen.findByLabelText(/^preset$/i), { target: { value: 'p1' } })
      fireEvent.click(screen.getByRole('button', { name: /apply preset/i }))

      await waitFor(() => expect(mockApplyPreset).toHaveBeenCalledWith('p1', SET_ID))
      await waitFor(() => expect(mockListConceptTree).toHaveBeenCalledTimes(2))
    })
  })

  describe('presets (admin)', () => {
    it('does not show "save as preset" for a non-admin', async () => {
      mockTree([node({ id: 'f', name: 'finance', depth: 0 })])
      renderTree(false)
      await waitFor(() => rowFor('finance'))
      expect(screen.queryByText(/save this set.s structure as a preset/i)).not.toBeInTheDocument()
    })

    it('shows "save as preset" for an admin once structure exists, and calls savePresetFromSet', async () => {
      mockTree([node({ id: 'f', name: 'finance', depth: 0 })])
      mockSavePresetFromSet.mockResolvedValue({ success: true, data: { id: 'p1' } })
      renderTree(true)
      await waitFor(() => rowFor('finance'))

      const nameInput = await screen.findByLabelText(/preset name/i)
      fireEvent.change(nameInput, { target: { value: 'Finance skeleton' } })
      fireEvent.click(screen.getByRole('button', { name: /^save as preset$/i }))

      await waitFor(() => expect(mockSavePresetFromSet).toHaveBeenCalledWith(SET_ID, 'Finance skeleton'))
    })
  })

  it('shows the suggested skeleton as a preview and writes nothing until Apply', async () => {
    mockTree([], [])
    mockSuggestSkeleton.mockResolvedValue({ success: true, data: { paths: [['finance', 'accounting']] } })
    mockApplySkeleton.mockResolvedValue({ success: true, data: { created: 2, skipped: 0 } })

    renderTree()
    await waitFor(() => screen.getByLabelText(/subject/i))

    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'finance' } })
    fireEvent.click(screen.getByRole('button', { name: /suggest a starting structure/i }))

    await waitFor(() => screen.getByText('accounting'))
    expect(mockApplySkeleton).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))
    await waitFor(() => expect(mockApplySkeleton).toHaveBeenCalledWith(SET_ID, [['finance', 'accounting']]))
  })

  it('discarding a suggested skeleton also writes nothing', async () => {
    mockTree([], [])
    mockSuggestSkeleton.mockResolvedValue({ success: true, data: { paths: [['finance', 'accounting']] } })

    renderTree()
    await waitFor(() => screen.getByLabelText(/subject/i))
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'finance' } })
    fireEvent.click(screen.getByRole('button', { name: /suggest a starting structure/i }))
    await waitFor(() => screen.getByText('accounting'))

    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(mockApplySkeleton).not.toHaveBeenCalled()
    expect(screen.queryByText('accounting')).not.toBeInTheDocument()
  })
})
