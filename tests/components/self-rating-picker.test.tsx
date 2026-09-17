// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SelfRatingPicker } from '@/components/study/SelfRatingPicker'
import { SELF_RATING_LABELS } from '@/lib/memory/self-rating'

afterEach(cleanup)

describe('SelfRatingPicker', () => {
  it('renders a radiogroup of four radios with the fixed labels and nothing pre-selected', () => {
    render(<SelfRatingPicker value={null} onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'How sure are you?' })).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      SELF_RATING_LABELS[1],
      SELF_RATING_LABELS[2],
      SELF_RATING_LABELS[3],
      SELF_RATING_LABELS[4],
    ])
    for (const r of radios) expect(r.getAttribute('aria-checked')).toBe('false')
  })

  it('marks only the selected value aria-checked', () => {
    render(<SelfRatingPicker value={3} onChange={() => {}} />)
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false'])
  })

  it('uses the custom prompt as the group name', () => {
    render(<SelfRatingPicker value={null} onChange={() => {}} prompt="Do you know this one?" />)
    expect(screen.getByRole('radiogroup', { name: 'Do you know this one?' })).toBeTruthy()
  })

  it('clicking calls onChange with the rating', () => {
    const onChange = vi.fn()
    render(<SelfRatingPicker value={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Unsure' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('with keyboard, pressing 3 calls onChange(3) and 5 does nothing', () => {
    const onChange = vi.fn()
    render(<SelfRatingPicker value={null} onChange={onChange} keyboard />)
    fireEvent.keyDown(window, { key: '3' })
    expect(onChange).toHaveBeenCalledWith(3)
    fireEvent.keyDown(window, { key: '5' })
    fireEvent.keyDown(window, { key: '0' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('without keyboard, number keys do nothing', () => {
    const onChange = vi.fn()
    render(<SelfRatingPicker value={null} onChange={onChange} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keyboard ignores keys typed into an input or textarea', () => {
    const onChange = vi.fn()
    render(
      <div>
        <SelfRatingPicker value={null} onChange={onChange} keyboard />
        <textarea aria-label="answer" />
      </div>,
    )
    fireEvent.keyDown(screen.getByLabelText('answer'), { key: '2' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disabled: clicks and keys do nothing, and the radios are disabled', () => {
    const onChange = vi.fn()
    render(<SelfRatingPicker value={2} onChange={onChange} keyboard disabled />)
    fireEvent.click(screen.getByRole('radio', { name: 'Certain' }))
    fireEvent.keyDown(window, { key: '4' })
    expect(onChange).not.toHaveBeenCalled()
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a key hint 1-4 under each option only when keyboard is on', () => {
    render(<SelfRatingPicker value={null} onChange={() => {}} keyboard />)
    screen.getAllByRole('radio').forEach((r, i) => expect(r.textContent).toContain(String(i + 1)))
    cleanup()
    render(<SelfRatingPicker value={null} onChange={() => {}} />)
    screen.getAllByRole('radio').forEach((r, i) => expect(r.textContent).not.toContain(String(i + 1)))
  })
})
