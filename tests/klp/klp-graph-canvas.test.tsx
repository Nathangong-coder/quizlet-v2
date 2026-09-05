// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { KlpGraphCanvas, outcomeOf } from '@/components/klp/KlpGraphCanvas'
import type { KlpNode, KlpEdge } from '@/components/klp/KlpCardPanel'

afterEach(cleanup)

const klps: KlpNode[] = [
  { id: 'k0', text: 'EBIT falls by 10', label: 'EBIT -10', kind: 'quantitative', weight: 4 },
  { id: 'k1', text: 'Net income falls by 6', label: 'Net income -6', kind: 'quantitative', weight: 3 },
  { id: 'k2', text: 'CFO rises by 4', label: 'CFO +4', kind: 'quantitative', weight: 2 },
]

const relations: KlpEdge[] = [
  { id: 'r0', from: 0, to: 1, type: 'causes', rationale: 'tax shield', probe: 'p1' },
  { id: 'r1', from: 1, to: 2, type: 'causes', rationale: 'add-back', probe: 'p2' },
]

function renderCanvas(props: Partial<Parameters<typeof KlpGraphCanvas>[0]> = {}) {
  return render(
    <KlpGraphCanvas
      klps={klps}
      relations={relations}
      activeIndex={null}
      onActiveChange={vi.fn()}
      hoveredEdgeId={null}
      onHoveredEdgeChange={vi.fn()}
      selectedEdgeId={null}
      onSelectedEdgeChange={vi.fn()}
      kLabel={(i) => `K${i + 1}`}
      rLabel={(i) => `R${i + 1}`}
      {...props}
    />,
  )
}

describe('outcomeOf', () => {
  /**
   * Colour comes from CREDIT, never from the status name. The vocabulary is
   * thirteen labels and unordered — `inversion` is not "more wrong" than
   * `omission`, it is differently wrong — so credit is the only axis a colour
   * can honestly encode, and widening the vocabulary must not need a change here.
   */
  it('maps credit, not label spelling', () => {
    expect(outcomeOf('correct')).toBe('right')
    expect(outcomeOf('partial')).toBe('partial')
    expect(outcomeOf('incomplete')).toBe('partial')
    expect(outcomeOf('failed')).toBe('wrong')
    expect(outcomeOf('inversion')).toBe('wrong')
    expect(outcomeOf('omission')).toBe('wrong')
  })

  /** Not tested is not the same claim as wrong, and must not be coloured as it. */
  it('treats a missing or unknown status as untested', () => {
    expect(outcomeOf(undefined)).toBe('untested')
    expect(outcomeOf('not_a_real_status')).toBe('untested')
  })
})

describe('controls', () => {
  it('offers zoom, fit, reset and full screen', () => {
    renderCanvas()
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument()
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument()
  })

  /** Reset only means something once something has been moved. */
  it('disables reset until a node has been dragged', () => {
    renderCanvas()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('renders nothing at all when the card has no relations', () => {
    const { container } = renderCanvas({ relations: [] })
    expect(container.firstChild).toBeNull()
  })
})

describe('the answer overlay', () => {
  const answer = { label: 'Their answer', statuses: { 0: 'correct', 1: 'failed' } }

  /** With no answer supplied there is nothing to toggle between. */
  it('shows no toggle when there is no answer to show', () => {
    renderCanvas()
    expect(screen.queryByRole('button', { name: 'Solution' })).toBeNull()
  })

  it('offers a Solution / answer toggle when an answer is supplied', () => {
    renderCanvas({ answer })
    expect(screen.getByRole('button', { name: 'Solution' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Their answer' })).toBeInTheDocument()
  })

  it('starts on the solution, uncoloured', () => {
    const { container } = renderCanvas({ answer })
    expect(container.querySelectorAll('rect[class*="stroke-red"]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Solution' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('colours failed points red and correct ones green once switched', () => {
    const { container } = renderCanvas({ answer })
    fireEvent.click(screen.getByRole('button', { name: 'Their answer' }))

    expect(container.querySelectorAll('rect[class*="stroke-red"]')).toHaveLength(1)
    expect(container.querySelectorAll('rect[class*="stroke-emerald"]')).toHaveLength(1)
    // K3 has no recorded status, so it stays neutral rather than reading as wrong.
    expect(container.querySelectorAll('rect[class*="stroke-border"]')).toHaveLength(1)
  })

  /**
   * The honesty constraint. Nothing records whether the LINK itself was got
   * wrong — that needs Spec 3's relation probes — so a red line is inferred
   * from its endpoints and the UI has to say so rather than implying a
   * measurement that does not exist.
   */
  it('says a red line is inferred from endpoints, not measured', () => {
    renderCanvas({ answer })
    fireEvent.click(screen.getByRole('button', { name: 'Their answer' }))
    expect(screen.getByText(/inferred from its endpoints, not measured/i)).toBeInTheDocument()
  })

  it('marks a chain broken where a step it runs through failed', () => {
    const { container } = renderCanvas({ answer })
    fireEvent.click(screen.getByRole('button', { name: 'Their answer' }))
    // Both edges touch K2, which failed.
    expect(container.querySelectorAll('path[class*="stroke-red"]')).toHaveLength(2)
  })
})
