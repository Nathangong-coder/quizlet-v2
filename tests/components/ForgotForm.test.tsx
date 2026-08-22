// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

const h = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }))

// A client component importing a server action drags next-auth into jsdom and
// the file dies at load, before any test runs (BUILD-QUEUE trap 7).
vi.mock('@/actions/auth-reset', () => ({
  requestPasswordReset: h.requestPasswordReset,
  FORGOT_FIXED_MESSAGE: 'If that account exists, we’ve sent a link to its email address.',
}))

import ForgotForm from '@/components/auth/ForgotForm'

beforeEach(() => {
  vi.clearAllMocks()
  h.requestPasswordReset.mockResolvedValue({ success: true, data: undefined })
})
afterEach(cleanup)

describe('ForgotForm', () => {
  it('calls the action with the typed identifier and then shows the ONE fixed message', async () => {
    render(<ForgotForm />)
    fireEvent.change(screen.getByLabelText(/email or handle/i), {
      target: { value: 'me@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send a reset link/i }))

    await waitFor(() =>
      expect(h.requestPasswordReset).toHaveBeenCalledWith({ identifier: 'me@example.com' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/if that account exists/i)
  })

  it('renders the SAME fixed message even when the action rejects, and never a second one', async () => {
    // The guard against re-introducing the enumeration oracle. A component
    // that rendered anything distinguishable on failure would tell a caller
    // which addresses have accounts — which is the whole thing the action
    // prevents.
    h.requestPasswordReset.mockRejectedValue(new Error('transport exploded'))
    render(<ForgotForm />)
    fireEvent.change(screen.getByLabelText(/email or handle/i), {
      target: { value: 'me@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send a reset link/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/if that account exists/i)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('shows nothing before the first submit', () => {
    render(<ForgotForm />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
