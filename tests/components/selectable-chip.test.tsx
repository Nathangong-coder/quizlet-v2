// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SelectableChip } from '@/components/ui/selectable-chip'

// vitest.config.ts has no `globals: true`, so RTL never registers auto-cleanup.
afterEach(cleanup)

describe('SelectableChip: announced state', () => {
  it('announces a toggle with aria-pressed', () => {
    render(<SelectableChip label="valuation" selected onToggle={() => {}} />)
    const chip = screen.getByRole('button', { name: 'valuation' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    // A toggle must not also claim to be a checkbox.
    expect(chip.getAttribute('aria-checked')).toBeNull()
  })

  it('announces a checkbox with aria-checked', () => {
    render(
      <SelectableChip label="valuation" semantics="checkbox" selected={false} onToggle={() => {}} />,
    )
    const chip = screen.getByRole('checkbox', { name: 'valuation' })
    expect(chip.getAttribute('aria-checked')).toBe('false')
    expect(chip.getAttribute('aria-pressed')).toBeNull()
  })

  it('is a real button, so it is focusable and keyboard-operable', () => {
    // The quiz-setup chip it replaces was a <div onClick> wrapping a readOnly
    // checkbox: unreachable by keyboard and announced as nothing.
    const onToggle = vi.fn()
    render(<SelectableChip label="matching" selected={false} onToggle={onToggle} />)
    const chip = screen.getByRole('button', { name: 'matching' })
    expect(chip.tagName).toBe('BUTTON')
    chip.focus()
    expect(document.activeElement).toBe(chip)
    fireEvent.click(chip)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('SelectableChip: selection is never colour alone', () => {
  it('renders a check mark when selected and a colour dot when not', () => {
    const { container, rerender } = render(
      <SelectableChip label="accounting" color="#ff0000" selected={false} onToggle={() => {}} />,
    )
    // Unselected: the category's identity dot, no check.
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('span[style*="background-color"]')).toBeTruthy()

    rerender(
      <SelectableChip label="accounting" color="#ff0000" selected onToggle={() => {}} />,
    )
    // Selected: a check mark, so state does not depend on colour perception.
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('never paints the category colour as text or fill', () => {
    // The two chips this replaced set `backgroundColor: ${color}20` with that
    // same colour as the TEXT. Dark mode is reachable now, and a dark palette
    // colour on a dark ground is unreadable. The dot is the only place a
    // user-chosen colour may appear.
    const { container } = render(
      <SelectableChip label="accounting" color="#1a1a2e" selected onToggle={() => {}} />,
    )
    const chip = screen.getByRole('button', { name: 'accounting' })
    expect(chip.getAttribute('style')).toBeNull()
    expect(container.querySelector('span[style*="background-color"]')).toBeNull()
  })
})

describe('SelectableChip: accessible name', () => {
  it('excludes decoration and counts from the announced name', () => {
    // ScopeBar renders "· 3 sets" and a card count inside the chip; neither
    // should become part of the control's name.
    render(
      <SelectableChip label="valuation" count={12} selected={false} onToggle={() => {}}>
        valuation<span>· 3 sets</span>
      </SelectableChip>,
    )
    expect(screen.getByRole('button', { name: 'valuation' })).toBeTruthy()
    // Still rendered visually, just not announced.
    expect(screen.getByText('· 3 sets')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
  })
})
