// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

const h = vi.hoisted(() => ({
  completePasswordReset: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

// A client component importing a server action drags next-auth into jsdom and
// the file dies at load, before any test runs (BUILD-QUEUE trap 7).
vi.mock('@/actions/auth-reset', () => ({
  completePasswordReset: h.completePasswordReset,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}))

import ResetPasswordForm from '@/components/auth/ResetPasswordForm'

beforeEach(() => {
  vi.clearAllMocks()
  h.completePasswordReset.mockResolvedValue({ success: true, data: undefined })
})
afterEach(cleanup)

function fill(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: password } })
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } })
}

describe('ResetPasswordForm', () => {
  it('NAMES the failure — unlike ForgotForm, the caller already holds a valid token', async () => {
    // Telling this caller the link expired or the password is too short
    // reveals nothing they did not already supply, so this form does not
    // collapse to one fixed message the way ForgotForm/ResendVerification do.
    h.completePasswordReset.mockResolvedValue({
      success: false,
      error: 'That reset link has expired.',
    })
    render(<ResetPasswordForm token="raw" />)
    fill('a'.repeat(12), 'a'.repeat(12))
    fireEvent.click(screen.getByRole('button', { name: /set my new password/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/expired/i)
    expect(h.push).not.toHaveBeenCalled()
  })

  it('a rejected call sets a GENERIC error and does not navigate', async () => {
    // The guard that matters: the try/catch around completePasswordReset is
    // the one deliberate deviation from the brief, closing a bug (an
    // unhandled rejection leaving nothing rendered) already fixed twice
    // elsewhere in this plan.
    h.completePasswordReset.mockRejectedValue(new Error('transport exploded'))
    render(<ResetPasswordForm token="raw" />)
    fill('a'.repeat(12), 'a'.repeat(12))
    fireEvent.click(screen.getByRole('button', { name: /set my new password/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong/i)
    expect(h.push).not.toHaveBeenCalled()
  })

  it('short-circuits on a password/confirm mismatch BEFORE calling the action', async () => {
    render(<ResetPasswordForm token="raw" />)
    fill('a'.repeat(12), 'b'.repeat(12))
    fireEvent.click(screen.getByRole('button', { name: /set my new password/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not match/i)
    expect(h.completePasswordReset).not.toHaveBeenCalled()
  })

  it('on success, pushes /login?reset=1', async () => {
    render(<ResetPasswordForm token="raw" />)
    fill('a'.repeat(12), 'a'.repeat(12))
    fireEvent.click(screen.getByRole('button', { name: /set my new password/i }))

    await waitFor(() =>
      expect(h.completePasswordReset).toHaveBeenCalledWith({
        token: 'raw',
        password: 'a'.repeat(12),
      }),
    )
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/login?reset=1'))
    expect(h.refresh).toHaveBeenCalled()
  })
})
