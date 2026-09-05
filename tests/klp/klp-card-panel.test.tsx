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
    // The type name appears in the legend AND in each caption, so the legend is
    // identified by its description text, which is unique to it.
    expect(screen.getByText(/one step produces another/)).toBeInTheDocument()
    expect(screen.getByText(/only true if the first is/)).toBeInTheDocument()
    expect(screen.queryByText(/learners mix these two up/)).toBeNull()
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
   * An R-number on a line says an edge exists and nothing about what it claims.
   * The rationale is the intended connection in words, so it is shown outright
   * rather than hidden behind a click.
   */
  it('captions every relation with its intended connection, without a click', () => {
    renderPanel()
    expect(screen.getByText(/tax shields part of it/)).toBeInTheDocument()
    expect(screen.getByText(/the add-back is what lifts CFO/)).toBeInTheDocument()
  })

  it('captions name the endpoints and the relation type', () => {
    renderPanel()
    const caption = screen.getByText(/tax shields part of it/).closest('div')!
    expect(caption).toHaveTextContent('R1')
    expect(caption).toHaveTextContent('K1 → K2')
    expect(caption).toHaveTextContent('causes')
  })

  /**
   * The probe is a different kind of thing from the rationale — not what the
   * link means, but the wrong answer proving the link carries information (one
   * that gets BOTH endpoints right and the connection wrong). Worth reading
   * deliberately, not while scanning, so it stays behind a click.
   */
  it('keeps the probe behind a click', () => {
    renderPanel()
    expect(screen.queryByText(/says net income falls 10/)).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'probe' })[0])
    expect(screen.getByText(/says net income falls 10/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'hide probe' }))
    expect(screen.queryByText(/says net income falls 10/)).toBeNull()
  })

  /** Hovering a caption is the same act as hovering its line. */
  it('dims the other relations when one caption is hovered', () => {
    renderPanel()
    const caption = screen.getByText(/tax shields part of it/).closest('div')!
    fireEvent.mouseEnter(caption)

    const other = screen.getByText(/the add-back is what lifts CFO/).closest('div')!
    expect(other.className).toContain('opacity-40')
    expect(caption.className).not.toContain('opacity-40')
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
