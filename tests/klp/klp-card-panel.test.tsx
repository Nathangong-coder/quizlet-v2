// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { KlpCardPanel, type KlpNode, type KlpEdge } from '@/components/klp/KlpCardPanel'

afterEach(cleanup)

const klps: KlpNode[] = [
  { id: 'k0', text: 'EBIT falls by 10', label: 'EBIT -10', kind: 'quantitative', weight: 4 },
  { id: 'k1', text: 'Net income falls by 6', label: 'Net income -6', kind: 'quantitative', weight: 3 },
  { id: 'k2', text: 'Depreciation is non-cash and is added back in CFO', label: 'Non-cash, added back', kind: 'mechanism', weight: 5 },
  { id: 'k3', text: 'CFO rises by 4', label: 'CFO +4', kind: 'quantitative', weight: 2 },
]

const relations: KlpEdge[] = [
  { id: 'r0', from: 0, to: 1, type: 'causes', rationale: 'tax shields part of it', probe: 'says net income falls 10' },
  { id: 'r1', from: 2, to: 3, type: 'requires', rationale: 'the add-back is what lifts CFO', probe: 'lifts CFO with no add-back' },
]

function renderPanel(props: Partial<Parameters<typeof KlpCardPanel>[0]> = {}) {
  return render(
    <KlpCardPanel cardTerm="Walk me through $10 of depreciation" klps={klps} relations={relations} {...props} />,
  )
}

describe('the list', () => {
  /** The shape the owner asked for: K1..Kn beside the full proposition. */
  it('numbers key points from K1, in order, with their full text', () => {
    renderPanel()
    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')

    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('K1')
    expect(items[0]).toHaveTextContent('EBIT falls by 10')
    expect(items[3]).toHaveTextContent('K4')
    expect(items[3]).toHaveTextContent('CFO rises by 4')
  })

  /** Numbering is 1-based because nobody reading a list counts from zero. */
  it('never renders a K0', () => {
    renderPanel()
    expect(screen.queryByText('K0')).toBeNull()
  })
})

describe('the graph', () => {
  it('draws one node per key point and one edge per relation', () => {
    const { container } = renderPanel()
    expect(container.querySelectorAll('svg rect')).toHaveLength(4)
    // Two paths per edge: a wide transparent hit target plus the visible line.
    expect(container.querySelectorAll('svg g[class*="cursor-pointer"] path[stroke="transparent"]')).toHaveLength(2)
  })

  it('labels relations R1, R2, … in order', () => {
    const { container } = renderPanel()
    const text = container.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('R1')
    expect(text).toContain('R2')
  })

  /**
   * A card whose relate call produced nothing is not a failure — an enumeration
   * genuinely has no dependencies. Drawing an empty graph would imply the
   * extraction broke.
   */
  it('says why there is no graph rather than drawing an empty one', () => {
    const { container } = renderPanel({ relations: [] })
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText(/enumeration/i)).toBeInTheDocument()
  })

  it('only legends the relation types actually present', () => {
    renderPanel()
    expect(screen.getByText('causes')).toBeInTheDocument()
    expect(screen.getByText('requires')).toBeInTheDocument()
    expect(screen.queryByText('confused_with')).toBeNull()
  })
})

describe('interactivity', () => {
  /**
   * The list and the graph are ONE control. Hovering a point dims everything it
   * does not touch, in both halves — which is the only reason to show both.
   */
  it('dims unrelated points when one is focused', () => {
    renderPanel()

    const k1 = screen.getByRole('button', { name: /EBIT falls by 10/ })
    fireEvent.mouseEnter(k1)

    // K1 relates to K2 only; K3 and K4 must dim.
    const k3 = screen.getByRole('button', { name: /Depreciation is non-cash/ })
    expect(k3.className).toContain('opacity-40')
    const k2 = screen.getByRole('button', { name: /Net income falls by 6/ })
    expect(k2.className).not.toContain('opacity-40')
  })

  it('clears the highlight when the pointer leaves', () => {
    renderPanel()

    const k1 = screen.getByRole('button', { name: /EBIT falls by 10/ })
    fireEvent.mouseEnter(k1)
    fireEvent.mouseLeave(k1)

    const k3 = screen.getByRole('button', { name: /Depreciation is non-cash/ })
    expect(k3.className).not.toContain('opacity-40')
  })

  /**
   * The probe is the whole reason an edge was kept: an answer that gets both
   * endpoints right and the link wrong. Showing it is showing why the edge
   * exists at all.
   */
  it('opens an edge to reveal its rationale and probe', () => {
    const { container } = renderPanel()

    expect(screen.queryByText(/tax shields part of it/)).toBeNull()

    const hitTarget = container.querySelectorAll('svg path[stroke="transparent"]')[0]
    fireEvent.click(hitTarget)

    expect(screen.getByText(/tax shields part of it/)).toBeInTheDocument()
    expect(screen.getByText(/says net income falls 10/)).toBeInTheDocument()
  })
})

describe('authoring status', () => {
  it('shows the separation score when the card has been authored', () => {
    renderPanel({ separation: 0.63, status: 'separated' })
    expect(screen.getByText(/separation 0\.63/)).toBeInTheDocument()
  })

  /** The flag is the deliverable of the discrimination loop, so it must be visible. */
  it('flags a low-discrimination card', () => {
    renderPanel({ separation: 0.13, status: 'low_discrimination' })
    expect(screen.getByText('low discrimination')).toBeInTheDocument()
  })

  it('shows no score for a legacy card that was never authored', () => {
    renderPanel({ separation: null, status: null })
    expect(screen.queryByText(/separation/)).toBeNull()
  })
})
