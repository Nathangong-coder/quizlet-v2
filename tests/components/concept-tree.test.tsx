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
  // Default: the selected concept has nothing filed under it. Tests that care
  // about the linked-cards panel override this.
  mockListConceptCards.mockResolvedValue({
    success: true,
    data: { conceptName: 'accounting', direct: [], descendants: [] },
  })
})

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
  setNodeStyle: vi.fn(),
  listConceptCards: vi.fn(),
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
  setNodeStyle,
  listConceptCards,
} from '@/actions/klt-tree'
import { suggestSkeleton, applySkeleton } from '@/actions/klt-seed'
import { listPresets, applyPreset, savePresetFromSet } from '@/actions/klt-presets'
import { toast } from 'sonner'

// Typed handles rather than `as any`, matching this repo's convention (see
// QuizSummary.test.tsx's "canReset opt-in" block) — `any` here is a
// no-explicit-any lint error and would raise the lint baseline.
const mockListConceptTree = listConceptTree as unknown as ReturnType<typeof vi.fn>
const mockCreateConcept = createConcept as unknown as ReturnType<typeof vi.fn>
const mockReparentConcept = reparentConcept as unknown as ReturnType<typeof vi.fn>
const mockRenameConcept = renameConcept as unknown as ReturnType<typeof vi.fn>
const mockMergeConcepts = mergeConcepts as unknown as ReturnType<typeof vi.fn>
const mockDeleteConcept = deleteConcept as unknown as ReturnType<typeof vi.fn>
const mockSetNodeStyle = setNodeStyle as unknown as ReturnType<typeof vi.fn>
const mockListConceptCards = listConceptCards as unknown as ReturnType<typeof vi.fn>
const mockSuggestSkeleton = suggestSkeleton as unknown as ReturnType<typeof vi.fn>
const mockApplySkeleton = applySkeleton as unknown as ReturnType<typeof vi.fn>
const mockListPresets = listPresets as unknown as ReturnType<typeof vi.fn>
const mockApplyPreset = applyPreset as unknown as ReturnType<typeof vi.fn>
const mockSavePresetFromSet = savePresetFromSet as unknown as ReturnType<typeof vi.fn>
const mockToastError = toast.error as unknown as ReturnType<typeof vi.fn>

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
  color?: string | null
  icon?: string | null
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
    color: o.color ?? null,
    icon: o.icon ?? null,
  }
}

function unplaced(kltId: string, name: string, linkCount = 1) {
  return { kltId, name, normalizedName: name, linkCount }
}

function mockTree(
  nodes: ReturnType<typeof node>[],
  unplacedList: ReturnType<typeof unplaced>[] = [],
  canEdit = true,
) {
  mockListConceptTree.mockResolvedValue({
    success: true,
    data: { setId: SET_ID, setTitle: SET_TITLE, nodes, unplaced: unplacedList, canEdit },
  })
}

/**
 * `finance > {accounting > {income statement, balance sheet}, valuation}`.
 * `accounting` is the branch with descendants, so it is what the
 * "carries other nodes" confirm path is exercised with.
 */
function sampleNodes() {
  return [
    node({ id: 'n-fin', kltId: 'finance', name: 'finance', childCount: 2 }),
    node({
      id: 'n-acct',
      kltId: 'acct',
      name: 'accounting',
      parentKltId: 'finance',
      depth: 1,
      ancestorIds: ['finance'],
      childCount: 2,
    }),
    node({
      id: 'n-val',
      kltId: 'val',
      name: 'valuation',
      parentKltId: 'finance',
      depth: 1,
      ancestorIds: ['finance'],
    }),
    node({
      id: 'n-is',
      kltId: 'is',
      name: 'income statement',
      parentKltId: 'acct',
      depth: 2,
      ancestorIds: ['finance', 'acct'],
    }),
    node({
      id: 'n-bs',
      kltId: 'bs',
      name: 'balance sheet',
      parentKltId: 'acct',
      depth: 2,
      ancestorIds: ['finance', 'acct'],
    }),
  ]
}

function renderTree(isAdmin = false, canEdit = true) {
  return render(
    <ConceptTree setId={SET_ID} setTitle={SET_TITLE} isAdmin={isAdmin} canEdit={canEdit} />,
  )
}

/** The read-only viewer's render: the tree of a set someone shared with them. */
async function renderReadOnly(unplacedList: ReturnType<typeof unplaced>[] = []) {
  mockTree(sampleNodes(), unplacedList, false)
  renderTree(false, false)
  await waitFor(() => expect(canvasNode('finance')).toBeTruthy())
}

/** The node's wrapper on the canvas, keyed by concept id. */
function canvasNode(kltId: string): HTMLElement {
  const el = document.querySelector(`[data-concept-node="${kltId}"]`)
  if (!el) throw new Error(`no canvas node for ${kltId}`)
  return el as HTMLElement
}

/** The draggable card itself — the first button inside the wrapper. */
function nodeCard(kltId: string): HTMLElement {
  return within(canvasNode(kltId)).getAllByRole('button')[0]
}

function drawnKltIds(): string[] {
  return [...document.querySelectorAll('[data-concept-node]')].map(
    (el) => el.getAttribute('data-concept-node') as string,
  )
}

/**
 * jsdom's synthetic drag events carry no `DataTransfer`, so a handler that
 * touches `e.dataTransfer` throws. Supplying a stub is what makes these
 * tests exercise the real handlers rather than a drag-shaped stand-in.
 */
function dataTransfer() {
  return { setData: vi.fn(), getData: vi.fn(), effectAllowed: '' }
}

function dragOnto(sourceEl: HTMLElement, targetEl: HTMLElement) {
  fireEvent.dragStart(sourceEl, { dataTransfer: dataTransfer() })
  fireEvent.dragOver(targetEl, { dataTransfer: dataTransfer() })
  fireEvent.drop(targetEl, { dataTransfer: dataTransfer() })
}

async function renderSample() {
  mockTree(sampleNodes())
  renderTree()
  await waitFor(() => expect(canvasNode('finance')).toBeTruthy())
}

/** Select a node, which is what opens the inspector. */
async function select(kltId: string) {
  fireEvent.click(nodeCard(kltId))
  await waitFor(() => expect(screen.getByLabelText('Close inspector')).toBeTruthy())
}

describe('ConceptTree canvas', () => {
  it('draws every concept as a node', async () => {
    await renderSample()
    expect(drawnKltIds().sort()).toEqual(['acct', 'bs', 'finance', 'is', 'val'])
  })

  it('draws one connector per parent-child pair', async () => {
    await renderSample()
    // Scoped to the connector layer: every lucide glyph on the canvas is an
    // <svg><path> too, so an unscoped query counts icons as edges.
    expect(screen.getByTestId('concept-edges').querySelectorAll('path')).toHaveLength(4)
  })

  it('hides a collapsed node’s descendants, and shows them again', async () => {
    await renderSample()
    fireEvent.click(screen.getByLabelText('Collapse accounting'))
    await waitFor(() => expect(drawnKltIds()).not.toContain('is'))
    expect(drawnKltIds()).toContain('acct')

    fireEvent.click(screen.getByLabelText('Expand accounting'))
    await waitFor(() => expect(drawnKltIds()).toContain('is'))
  })

  it('offers no collapse control on a childless node', async () => {
    await renderSample()
    expect(within(canvasNode('val')).getAllByRole('button')).toHaveLength(1)
  })

  it('narrows to matching concepts and keeps their ancestors drawn', async () => {
    await renderSample()
    fireEvent.change(screen.getByLabelText('Filter concepts'), { target: { value: 'income' } })
    await waitFor(() => expect(drawnKltIds()).not.toContain('val'))
    // The match, plus the chain above it — a matched leaf with no visible
    // parent is unreadable.
    expect(drawnKltIds().sort()).toEqual(['acct', 'finance', 'is'])
  })
})

describe('ConceptTree drag and drop', () => {
  it('re-parents on a drop and writes immediately when only one node moves', async () => {
    mockReparentConcept.mockResolvedValue({ success: true, data: null })
    await renderSample()

    dragOnto(nodeCard('is'), nodeCard('val'))

    await waitFor(() => expect(mockReparentConcept).toHaveBeenCalledWith(SET_ID, 'is', 'val'))
    // No confirm: stopping to confirm a one-node drag is what made the old
    // editor feel broken, and nothing else moved.
    expect(screen.queryByText(/Confirm move/)).toBeNull()
  })

  it('confirms first when the drag carries descendants, and says how many', async () => {
    mockReparentConcept.mockResolvedValue({ success: true, data: null })
    await renderSample()

    dragOnto(nodeCard('acct'), nodeCard('val'))

    await waitFor(() => expect(screen.getByText(/This moves 3 concepts/)).toBeTruthy())
    expect(mockReparentConcept).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm move' }))
    await waitFor(() => expect(mockReparentConcept).toHaveBeenCalledWith(SET_ID, 'acct', 'val'))
  })

  it('cancelling the confirm writes nothing', async () => {
    await renderSample()
    dragOnto(nodeCard('acct'), nodeCard('val'))
    await waitFor(() => expect(screen.getByText(/This moves 3 concepts/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/This moves 3 concepts/)).toBeNull())
    expect(mockReparentConcept).not.toHaveBeenCalled()
  })

  it('refuses a drop that would make a node its own descendant', async () => {
    await renderSample()
    dragOnto(nodeCard('finance'), nodeCard('is'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockReparentConcept).not.toHaveBeenCalled()
  })

  it('refuses a drop onto the parent a node already has', async () => {
    await renderSample()
    dragOnto(nodeCard('is'), nodeCard('acct'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockReparentConcept).not.toHaveBeenCalled()
  })

  it('makes a node a root when dropped on empty canvas', async () => {
    mockReparentConcept.mockResolvedValue({ success: true, data: null })
    await renderSample()

    const canvas = screen.getByTestId('concept-canvas')
    fireEvent.dragStart(nodeCard('is'), { dataTransfer: dataTransfer() })
    fireEvent.dragOver(canvas, { dataTransfer: dataTransfer() })
    fireEvent.drop(canvas, { dataTransfer: dataTransfer() })

    await waitFor(() => expect(mockReparentConcept).toHaveBeenCalledWith(SET_ID, 'is', null))
  })

  it('dragging an UNPLACED concept onto a node creates it there, by name', async () => {
    // An unplaced concept has no row to move — `createConcept` upserts the
    // shared `Klt` by normalized name and places it in this set.
    mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'wacc' } })
    mockTree(sampleNodes(), [unplaced('wacc', 'WACC', 3)])
    renderTree()
    await waitFor(() => expect(canvasNode('finance')).toBeTruthy())

    const chip = screen.getByText('WACC').closest('li') as HTMLElement
    dragOnto(chip, nodeCard('val'))

    await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'WACC', 'val'))
    expect(mockReparentConcept).not.toHaveBeenCalled()
  })
})

describe('ConceptTree side panel', () => {
  it('lists unplaced concepts with their link counts', async () => {
    mockTree(sampleNodes(), [unplaced('wacc', 'WACC', 3)])
    renderTree()
    await waitFor(() => expect(screen.getByText('WACC')).toBeTruthy())
    expect(screen.getByText('Unplaced')).toBeTruthy()
  })

  it('says so when nothing is unplaced', async () => {
    await renderSample()
    expect(screen.getByText(/Every concept your cards cite has a place/)).toBeTruthy()
  })

  it('places an unplaced concept as a root when nothing is selected', async () => {
    mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'wacc' } })
    mockTree(sampleNodes(), [unplaced('wacc', 'WACC')])
    renderTree()
    await waitFor(() => expect(screen.getByText('WACC')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Place as root' }))
    await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'WACC', null))
  })

  it('places an unplaced concept under whichever node is selected', async () => {
    // The button's meaning follows the canvas selection — no second parent
    // picker, and it is the keyboard route to the same result as a drag.
    mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'wacc' } })
    mockTree(sampleNodes(), [unplaced('wacc', 'WACC')])
    renderTree()
    await waitFor(() => expect(canvasNode('val')).toBeTruthy())

    await select('val')
    fireEvent.click(screen.getByRole('button', { name: 'Place under valuation' }))
    await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'WACC', 'val'))
  })

  it('selects a node when its row in "All concepts" is clicked', async () => {
    await renderSample()
    const allConcepts = screen.getByText('All concepts').closest('section') as HTMLElement
    fireEvent.click(within(allConcepts).getByText('valuation'))
    await waitFor(() => expect(screen.getByLabelText('Close inspector')).toBeTruthy())
    expect(screen.getByLabelText('Move valuation under')).toBeTruthy()
  })
})

describe('ConceptTree inspector', () => {
  it('opens on selection and closes again', async () => {
    await renderSample()
    await select('acct')
    fireEvent.click(screen.getByLabelText('Close inspector'))
    await waitFor(() => expect(screen.queryByLabelText('Close inspector')).toBeNull())
  })

  it('renames using the concept id, not the row id', async () => {
    mockRenameConcept.mockResolvedValue({ success: true, data: null })
    await renderSample()
    await select('acct')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'financial accounting' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() =>
      expect(mockRenameConcept).toHaveBeenCalledWith(SET_ID, 'acct', 'financial accounting'),
    )
  })

  it('offers neither the node itself nor a descendant as a new parent', async () => {
    await renderSample()
    await select('acct')

    const options = within(screen.getByLabelText('Move accounting under'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toContain('valuation')
    expect(options).not.toContain('accounting')
    expect(options).not.toContain('income statement')
  })

  it('moves through the parent select, taking the same confirm path as a drag', async () => {
    mockReparentConcept.mockResolvedValue({ success: true, data: null })
    await renderSample()
    await select('acct')

    fireEvent.change(screen.getByLabelText('Move accounting under'), { target: { value: 'val' } })
    await waitFor(() => expect(screen.getByText(/This moves 3 concepts/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm move' }))

    await waitFor(() => expect(mockReparentConcept).toHaveBeenCalledWith(SET_ID, 'acct', 'val'))
  })

  it('adds a child under the selected concept', async () => {
    mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'new' } })
    await renderSample()
    await select('val')

    fireEvent.change(screen.getByLabelText('New concept under valuation'), {
      target: { value: 'terminal value' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'terminal value', 'val'),
    )
  })

  it('requires a confirm before merging, since merge deletes the source', async () => {
    mockMergeConcepts.mockResolvedValue({ success: true, data: null })
    await renderSample()
    await select('val')

    fireEvent.change(screen.getByLabelText('Merge valuation into'), { target: { value: 'acct' } })
    await waitFor(() => expect(screen.getByText(/This deletes/)).toBeTruthy())
    expect(mockMergeConcepts).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }))
    await waitFor(() => expect(mockMergeConcepts).toHaveBeenCalledWith(SET_ID, 'val', 'acct'))
  })

  it('cancelling the merge confirm never calls mergeConcepts', async () => {
    await renderSample()
    await select('val')

    fireEvent.change(screen.getByLabelText('Merge valuation into'), { target: { value: 'acct' } })
    await waitFor(() => expect(screen.getByText(/This deletes/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText(/This deletes/)).toBeNull())
    expect(mockMergeConcepts).not.toHaveBeenCalled()
  })

  it('deletes a childless concept by concept id', async () => {
    mockDeleteConcept.mockResolvedValue({ success: true, data: null })
    await renderSample()
    await select('val')

    fireEvent.click(screen.getByRole('button', { name: 'Delete concept' }))
    await waitFor(() => expect(mockDeleteConcept).toHaveBeenCalledWith(SET_ID, 'val'))
  })

  it('disables Delete while the concept still has children, and says why', async () => {
    await renderSample()
    await select('acct')

    expect(screen.getByRole('button', { name: 'Delete concept' })).toBeDisabled()
    expect(screen.getByText(/move or delete them first/i)).toBeTruthy()
  })
})

describe('ConceptTree node appearance', () => {
  it('saves a colour by palette key', async () => {
    mockSetNodeStyle.mockResolvedValue({ success: true, data: null })
    await renderSample()
    await select('val')

    fireEvent.click(screen.getByLabelText('Teal'))
    await waitFor(() =>
      expect(mockSetNodeStyle).toHaveBeenCalledWith(SET_ID, 'val', { color: 'teal' }),
    )
  })

  it('clears a colour back to inheriting from the branch', async () => {
    mockSetNodeStyle.mockResolvedValue({ success: true, data: null })
    mockTree([
      node({ id: 'n-fin', kltId: 'finance', name: 'finance', color: 'violet' }),
      node({ id: 'n-val', kltId: 'val', name: 'valuation', color: 'teal' }),
    ])
    renderTree()
    await waitFor(() => expect(canvasNode('val')).toBeTruthy())
    await select('val')

    fireEvent.click(screen.getByLabelText('Inherit colour from parent'))
    await waitFor(() =>
      expect(mockSetNodeStyle).toHaveBeenCalledWith(SET_ID, 'val', { color: null }),
    )
  })

  it('saves an icon by key, without touching the colour', async () => {
    // `undefined` leaves a field alone and `null` clears it — picking an icon
    // must not silently reset a colour the user chose earlier.
    mockSetNodeStyle.mockResolvedValue({ success: true, data: null })
    await renderSample()
    await select('val')

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByLabelText('Brain'))

    await waitFor(() =>
      expect(mockSetNodeStyle).toHaveBeenCalledWith(SET_ID, 'val', { icon: 'brain' }),
    )
  })
})

describe('ConceptTree seeding', () => {
  it('adds a root concept with a null parent', async () => {
    mockCreateConcept.mockResolvedValue({ success: true, data: { kltId: 'new' } })
    await renderSample()

    fireEvent.change(screen.getByLabelText('New root concept name'), { target: { value: 'markets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add root concept' }))

    await waitFor(() => expect(mockCreateConcept).toHaveBeenCalledWith(SET_ID, 'markets', null))
  })

  it('shows the suggested skeleton as a preview and writes nothing until Apply', async () => {
    mockSuggestSkeleton.mockResolvedValue({ success: true, data: { paths: [['finance', 'debt']] } })
    mockApplySkeleton.mockResolvedValue({ success: true, data: { created: 2, skipped: 0 } })
    await renderSample()

    fireEvent.click(screen.getByRole('button', { name: 'Suggest a starting structure' }))
    await waitFor(() => expect(screen.getByText(/nothing has been written yet/i)).toBeTruthy())
    expect(mockApplySkeleton).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(mockApplySkeleton).toHaveBeenCalledWith(SET_ID, [['finance', 'debt']]))
  })

  it('discarding a suggested skeleton also writes nothing', async () => {
    mockSuggestSkeleton.mockResolvedValue({ success: true, data: { paths: [['finance', 'debt']] } })
    await renderSample()

    fireEvent.click(screen.getByRole('button', { name: 'Suggest a starting structure' }))
    await waitFor(() => expect(screen.getByText(/nothing has been written yet/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(screen.queryByText(/nothing has been written yet/i)).toBeNull())
    expect(mockApplySkeleton).not.toHaveBeenCalled()
  })
})

describe('ConceptTree empty-structure panel', () => {
  it('appears when the set has no placed nodes at all', async () => {
    mockTree([])
    renderTree()
    await waitFor(() => expect(screen.getByText('No concepts yet')).toBeTruthy())
  })

  it('appears, phrased "no structure yet", when concepts exist but none is placed', async () => {
    mockTree([], [unplaced('wacc', 'WACC')])
    renderTree()
    await waitFor(() => expect(screen.getByText('No structure yet')).toBeTruthy())
  })

  it('does not appear once at least one concept is placed', async () => {
    await renderSample()
    expect(screen.queryByText('No concepts yet')).toBeNull()
    expect(screen.queryByText('No structure yet')).toBeNull()
  })

  it('offers manual entry alongside the AI seam, prefilling the subject from setTitle', async () => {
    mockTree([])
    renderTree()
    await waitFor(() => expect(screen.getByText('No concepts yet')).toBeTruthy())
    expect(screen.getByLabelText('New root concept name')).toBeTruthy()
    expect(screen.getByLabelText('Subject')).toHaveValue(SET_TITLE)
  })

  it('offers a real preset picker, and says so when none have been saved', async () => {
    mockTree([])
    renderTree()
    await waitFor(() => expect(screen.getByText('No concepts yet')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('No presets saved yet.')).toBeTruthy())
  })

  it('applying a preset calls applyPreset with the chosen id and this set', async () => {
    mockListPresets.mockResolvedValue({
      success: true,
      data: [{ id: 'preset-1', name: 'finance skeleton', pathCount: 4 }],
    })
    mockApplyPreset.mockResolvedValue({ success: true, data: { created: 4, skipped: 0 } })
    mockTree([])
    renderTree()
    await waitFor(() => expect(screen.getByText('No concepts yet')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'preset-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }))

    await waitFor(() => expect(mockApplyPreset).toHaveBeenCalledWith('preset-1', SET_ID))
  })
})

describe('ConceptTree presets (admin)', () => {
  it('does not show "save as preset" for a non-admin', async () => {
    await renderSample()
    expect(screen.queryByLabelText('Preset name')).toBeNull()
  })

  it('shows it for an admin once structure exists, and calls savePresetFromSet', async () => {
    mockSavePresetFromSet.mockResolvedValue({ success: true, data: { skipped: 0 } })
    mockTree(sampleNodes())
    renderTree(true)
    await waitFor(() => expect(screen.getByLabelText('Preset name')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'finance skeleton' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as preset' }))

    await waitFor(() =>
      expect(mockSavePresetFromSet).toHaveBeenCalledWith(SET_ID, 'finance skeleton'),
    )
  })
})

describe('read-only viewing (a set someone shared)', () => {
  it('still draws the whole tree — the map is the point', async () => {
    await renderReadOnly()
    expect(drawnKltIds().sort()).toEqual(['acct', 'bs', 'finance', 'is', 'val'])
  })

  it('makes no node a drag source, so no gesture appears to work and then fails at the server', async () => {
    await renderReadOnly()
    for (const kltId of drawnKltIds()) {
      expect(nodeCard(kltId).getAttribute('draggable')).toBe('false')
    }
  })

  it('ignores a drop even if one is forced through, calling no write', async () => {
    await renderReadOnly()
    dragOnto(nodeCard('is'), nodeCard('val'))
    await waitFor(() => expect(mockReparentConcept).not.toHaveBeenCalled())
  })

  it('renders no control that writes structure', async () => {
    await renderReadOnly()
    expect(screen.queryByLabelText('New root concept name')).toBeNull()
    expect(screen.queryByRole('button', { name: /suggest a starting structure/i })).toBeNull()
    expect(screen.queryByLabelText('Preset')).toBeNull()
    expect(screen.queryByLabelText('Preset name')).toBeNull()
  })

  it('never asks the server for presets — that action is owner-gated and would only toast', async () => {
    await renderReadOnly()
    expect(mockListPresets).not.toHaveBeenCalled()
  })

  it('opens the inspector as a details view: no rename, move, colour, merge or delete', async () => {
    await renderReadOnly()
    await select('acct')

    expect(screen.queryByLabelText('Move accounting under')).toBeNull()
    expect(screen.queryByLabelText('Merge accounting into')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete concept/i })).toBeNull()
    expect(screen.queryByLabelText('Inherit colour from parent')).toBeNull()
    expect(screen.queryByLabelText(/new concept under/i)).toBeNull()
  })

  it('tells the viewer where the concept sits, since it cannot show them the parent picker', async () => {
    await renderReadOnly()
    await select('acct')
    expect(screen.getByText('finance', { selector: 'strong' })).toBeInTheDocument()
  })

  it('offers no Place button on an unplaced concept, but still lists it', async () => {
    await renderReadOnly([unplaced('k-wc', 'working capital')])
    expect(screen.getByText('working capital')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /place/i })).toBeNull()
  })

  it('replaces the owner-facing seeding panel with a plain explanation', async () => {
    mockTree([], [unplaced('k-wc', 'working capital')], false)
    renderTree(false, false)
    await waitFor(() => expect(screen.getByText('No structure yet')).toBeInTheDocument())

    expect(screen.getByText(/into a tree yet/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('New root concept name')).toBeNull()
    expect(screen.queryByLabelText('Subject')).toBeNull()
  })
})

describe('the linked-cards panel', () => {
  interface CardSeed {
    cardId: string
    term: string
    labels: (string | null)[]
    via?: string[]
  }

  function cards(direct: CardSeed[], descendants: CardSeed[] = []) {
    const shape = (c: CardSeed) => ({
      cardId: c.cardId,
      term: c.term,
      viaConcepts: c.via ?? [],
      klps: c.labels.map((label, i) => ({
        id: `${c.cardId}-klp-${i}`,
        label,
        text: `full text ${i}`,
        rank: 1,
      })),
    })
    mockListConceptCards.mockResolvedValue({
      success: true,
      data: {
        conceptName: 'accounting',
        direct: direct.map(shape),
        descendants: descendants.map(shape),
      },
    })
  }

  it('asks for the selected concept, scoped to this set', async () => {
    cards([])
    await renderSample()
    await select('acct')
    await waitFor(() => expect(mockListConceptCards).toHaveBeenCalledWith(SET_ID, 'acct'))
  })

  it('lists each card with the key point that filed it, linking into the set', async () => {
    cards([{ cardId: 'card-1', term: 'Goodwill', labels: ['impairment test'] }])
    await renderSample()
    await select('acct')

    const link = await screen.findByRole('link', { name: /goodwill/i })
    expect(link).toHaveAttribute('href', `/sets/${SET_ID}#card-card-1`)
    expect(screen.getByText('impairment test')).toBeInTheDocument()
  })

  it('falls back to the full proposition when a key point has no short label', async () => {
    cards([{ cardId: 'card-1', term: 'Goodwill', labels: [null] }])
    await renderSample()
    await select('acct')

    expect(await screen.findByText('full text 0')).toBeInTheDocument()
  })

  it('keeps descendant cards behind an expander, counted', async () => {
    cards(
      [{ cardId: 'card-1', term: 'Goodwill', labels: ['a'] }],
      [{ cardId: 'card-2', term: 'Current ratio', labels: ['b'], via: ['working capital'] }],
    )
    await renderSample()
    await select('acct')

    await screen.findByRole('link', { name: /goodwill/i })
    expect(screen.queryByText(/current ratio/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /1 more under child concept/i }))

    expect(await screen.findByRole('link', { name: /current ratio/i })).toBeInTheDocument()
    expect(screen.getByText(/via working capital/i)).toBeInTheDocument()
  })

  it('says so plainly when nothing is filed under the concept', async () => {
    cards([])
    await renderSample()
    await select('acct')

    expect(await screen.findByText(/nothing is filed under this concept yet/i)).toBeInTheDocument()
  })

  it('renders for a read-only viewer too — this is the whole reason they opened the tree', async () => {
    cards([{ cardId: 'card-1', term: 'Goodwill', labels: ['impairment test'] }])
    await renderReadOnly()
    await select('acct')

    expect(await screen.findByRole('link', { name: /goodwill/i })).toBeInTheDocument()
  })

  it('refetches when the selection moves to a different concept', async () => {
    cards([])
    await renderSample()
    await select('acct')
    await waitFor(() => expect(mockListConceptCards).toHaveBeenCalledWith(SET_ID, 'acct'))

    fireEvent.click(nodeCard('val'))
    await waitFor(() => expect(mockListConceptCards).toHaveBeenCalledWith(SET_ID, 'val'))
  })
})
