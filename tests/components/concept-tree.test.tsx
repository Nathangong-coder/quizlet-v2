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
  reparentConcept: vi.fn(),
  renameConcept: vi.fn(),
  mergeConcepts: vi.fn(),
  deleteConcept: vi.fn(),
}))
vi.mock('@/actions/klt-seed', () => ({
  suggestSkeleton: vi.fn(),
  applySkeleton: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  listConceptTree,
  reparentConcept,
  renameConcept,
  mergeConcepts,
  deleteConcept,
} from '@/actions/klt-tree'
import { suggestSkeleton, applySkeleton } from '@/actions/klt-seed'

// Typed handles rather than `as any`, matching this repo's convention (see
// QuizSummary.test.tsx's "canReset opt-in" block) — `any` here is a
// no-explicit-any lint error and would raise the lint baseline.
const mockListConceptTree = listConceptTree as unknown as ReturnType<typeof vi.fn>
const mockReparentConcept = reparentConcept as unknown as ReturnType<typeof vi.fn>
const mockRenameConcept = renameConcept as unknown as ReturnType<typeof vi.fn>
const mockMergeConcepts = mergeConcepts as unknown as ReturnType<typeof vi.fn>
const mockDeleteConcept = deleteConcept as unknown as ReturnType<typeof vi.fn>
const mockSuggestSkeleton = suggestSkeleton as unknown as ReturnType<typeof vi.fn>
const mockApplySkeleton = applySkeleton as unknown as ReturnType<typeof vi.fn>

interface NodeOverrides {
  id: string
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
    name: o.name,
    normalizedName: o.name,
    parentKltId: o.parentKltId ?? null,
    depth: o.depth ?? 0,
    ancestorIds: o.ancestorIds ?? [],
    linkCount: o.linkCount ?? 0,
    childCount: o.childCount ?? 0,
  }
}

describe('ConceptTree', () => {
  it('renders the tree indented by depth', async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [
        node({ id: 'f', name: 'finance', depth: 0 }),
        node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
      ],
    })

    render(<ConceptTree />)

    const financeRow = await waitFor(() => rowFor('finance'))
    const accountingRow = rowFor('accounting')
    expect(financeRow.getAttribute('data-depth')).toBe('0')
    expect(accountingRow.getAttribute('data-depth')).toBe('1')
  })

  it("disables Delete for a node with children, and says why", async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [
        node({ id: 'f', name: 'finance', depth: 0, childCount: 1 }),
        node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
      ],
    })

    render(<ConceptTree />)
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    expect(within(financeRow).getByRole('button', { name: /^delete$/i })).toBeDisabled()
    expect(within(financeRow).getByText(/has 1 child/i)).toBeInTheDocument()

    // The childless node is NOT disabled and carries no reason text.
    const accountingRow = rowFor('accounting')
    expect(within(accountingRow).getByRole('button', { name: /^delete$/i })).not.toBeDisabled()
  })

  it('does not offer a node itself as its own new parent, nor a descendant of itself', async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [
        node({ id: 'f', name: 'finance', depth: 0 }),
        node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
        node({ id: 'v', name: 'valuation', depth: 0 }),
      ],
    })

    render(<ConceptTree />)
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const moveSelect = within(financeRow).getByLabelText(/move finance under/i) as HTMLSelectElement
    const optionLabels = Array.from(moveSelect.options).map((o) => o.textContent)

    expect(optionLabels).not.toContain('finance')
    // 'accounting' is a descendant of 'finance' — offering it would let a
    // move make 'finance' its own ancestor.
    expect(optionLabels).not.toContain('accounting')
    // 'valuation' is unrelated and must remain offered.
    expect(optionLabels).toContain('valuation')
  })

  it('shows the suggested skeleton as a preview and writes nothing until Apply', async () => {
    mockListConceptTree.mockResolvedValue({ success: true, data: [] })
    mockSuggestSkeleton.mockResolvedValue({
      success: true,
      data: { paths: [['finance', 'accounting']] },
    })
    mockApplySkeleton.mockResolvedValue({ success: true, data: { created: 2, skipped: 0 } })

    render(<ConceptTree />)
    await waitFor(() => screen.getByLabelText(/subject/i))

    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'finance' } })
    fireEvent.click(screen.getByRole('button', { name: /suggest a starting structure/i }))

    await waitFor(() => screen.getByText('accounting'))
    expect(mockApplySkeleton).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))
    await waitFor(() => expect(mockApplySkeleton).toHaveBeenCalledWith([['finance', 'accounting']]))
  })

  it('discarding a suggested skeleton also writes nothing', async () => {
    mockListConceptTree.mockResolvedValue({ success: true, data: [] })
    mockSuggestSkeleton.mockResolvedValue({
      success: true,
      data: { paths: [['finance', 'accounting']] },
    })

    render(<ConceptTree />)
    await waitFor(() => screen.getByLabelText(/subject/i))
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'finance' } })
    fireEvent.click(screen.getByRole('button', { name: /suggest a starting structure/i }))
    await waitFor(() => screen.getByText('accounting'))

    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(mockApplySkeleton).not.toHaveBeenCalled()
    expect(screen.queryByText('accounting')).not.toBeInTheDocument()
  })

  it('requires a confirm before merging, since merge deletes the source', async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [
        node({ id: 'f', name: 'finance', depth: 0 }),
        node({ id: 'v', name: 'valuation', depth: 0 }),
      ],
    })
    mockMergeConcepts.mockResolvedValue({ success: true, data: null })

    render(<ConceptTree />)
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const mergeSelect = within(financeRow).getByLabelText(/merge finance into/i) as HTMLSelectElement
    fireEvent.change(mergeSelect, { target: { value: 'v' } })

    // Selecting a target alone must NOT merge — a confirm step is required
    // because merge deletes the source node.
    expect(mockMergeConcepts).not.toHaveBeenCalled()
    await waitFor(() => screen.getByRole('button', { name: /confirm merge/i }))

    fireEvent.click(screen.getByRole('button', { name: /confirm merge/i }))
    await waitFor(() => expect(mockMergeConcepts).toHaveBeenCalledWith('f', 'v'))
  })

  it('canceling the merge confirm never calls mergeConcepts', async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [
        node({ id: 'f', name: 'finance', depth: 0 }),
        node({ id: 'v', name: 'valuation', depth: 0 }),
      ],
    })

    render(<ConceptTree />)
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const mergeSelect = within(financeRow).getByLabelText(/merge finance into/i) as HTMLSelectElement
    fireEvent.change(mergeSelect, { target: { value: 'v' } })

    await waitFor(() => screen.getByRole('button', { name: /cancel merge/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel merge/i }))

    expect(mockMergeConcepts).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /confirm merge/i })).not.toBeInTheDocument()
  })

  it('moving a node calls reparentConcept with null for "(make a root)"', async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [
        node({ id: 'f', name: 'finance', depth: 0 }),
        node({ id: 'a', name: 'accounting', parentKltId: 'f', depth: 1, ancestorIds: ['f'] }),
      ],
    })
    mockReparentConcept.mockResolvedValue({ success: true, data: null })

    render(<ConceptTree />)
    await waitFor(() => rowFor('accounting'))

    const accountingRow = rowFor('accounting')
    const moveSelect = within(accountingRow).getByLabelText(/move accounting under/i)
    fireEvent.change(moveSelect, { target: { value: '' } })

    await waitFor(() => expect(mockReparentConcept).toHaveBeenCalledWith('a', null))
  })

  it('renames a node via the inline input', async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [node({ id: 'f', name: 'finance', depth: 0 })],
    })
    mockRenameConcept.mockResolvedValue({ success: true, data: null })

    render(<ConceptTree />)
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    const renameInput = within(financeRow).getByLabelText(/rename finance/i)
    fireEvent.change(renameInput, { target: { value: 'financial statements' } })
    fireEvent.click(within(financeRow).getByRole('button', { name: /^rename$/i }))

    await waitFor(() =>
      expect(mockRenameConcept).toHaveBeenCalledWith('f', 'financial statements'),
    )
  })

  it('deleting a childless node calls deleteConcept', async () => {
    mockListConceptTree.mockResolvedValue({
      success: true,
      data: [node({ id: 'f', name: 'finance', depth: 0, childCount: 0 })],
    })
    mockDeleteConcept.mockResolvedValue({ success: true, data: null })

    render(<ConceptTree />)
    await waitFor(() => rowFor('finance'))

    const financeRow = rowFor('finance')
    fireEvent.click(within(financeRow).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mockDeleteConcept).toHaveBeenCalledWith('f'))
  })
})
