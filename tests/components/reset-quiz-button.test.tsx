// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ resetQuizAttempt: vi.fn(), push: vi.fn() }))

vi.mock('@/actions/memory', () => ({ resetQuizAttempt: h.resetQuizAttempt }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ResetQuizButton } from '@/components/memory/ResetQuizButton'

// RTL's auto-cleanup needs a global afterEach, which this repo doesn't
// register (vitest.config.ts has no `globals: true`). Without it the first
// test's DOM survives into the second and getByRole finds two buttons.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  h.resetQuizAttempt.mockResolvedValue({ success: true })
})

describe('ResetQuizButton', () => {
  it('does not erase until the confirmation phrase is typed exactly', () => {
    // This deletes graded work permanently. A one-click confirm is too cheap.
    render(<ResetQuizButton attemptId="att1" setId="set1" />)
    fireEvent.click(screen.getByRole('button', { name: /reset this quiz/i }))

    const confirmButton = screen.getByRole('button', { name: /^delete$/i })
    expect(confirmButton).toBeDisabled()
    expect(h.resetQuizAttempt).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'delete' } })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'DELETE' } })
    expect(confirmButton).toBeEnabled()
  })

  it('erases and returns to the profile on confirmation', async () => {
    render(<ResetQuizButton attemptId="att1" setId="set1" />)
    fireEvent.click(screen.getByRole('button', { name: /reset this quiz/i }))
    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(h.resetQuizAttempt).toHaveBeenCalledWith('att1'))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/profile'))
  })

  it('stays put and reports the error when the erasure fails', async () => {
    // A failed erase must not navigate away — the quiz is still there, and
    // sending the learner to /profile would read as success.
    h.resetQuizAttempt.mockResolvedValue({ success: false, error: 'Failed to reset this quiz' })
    render(<ResetQuizButton attemptId="att1" setId="set1" />)
    fireEvent.click(screen.getByRole('button', { name: /reset this quiz/i }))
    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(h.resetQuizAttempt).toHaveBeenCalledWith('att1'))
    expect(h.push).not.toHaveBeenCalled()
  })

  it('clears a half-typed phrase on cancel', async () => {
    // Reopening with the phrase still filled in would leave Delete armed,
    // turning the next stray click into an erase.
    render(<ResetQuizButton attemptId="att1" setId="set1" />)
    fireEvent.click(screen.getByRole('button', { name: /reset this quiz/i }))
    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    fireEvent.click(screen.getByRole('button', { name: /reset this quiz/i }))
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })
})
