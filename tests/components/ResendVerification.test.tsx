// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

const h = vi.hoisted(() => ({ resendVerification: vi.fn() }))

// A client component importing a server action drags next-auth into jsdom and
// the file dies at load, before any test runs (BUILD-QUEUE trap 7).
vi.mock('@/actions/auth-verify', () => ({
  resendVerification: h.resendVerification,
  RESEND_FIXED_MESSAGE: 'If that account exists, we’ve sent a link.',
}))

import ResendVerification from '@/components/auth/ResendVerification'

beforeEach(() => {
  vi.clearAllMocks()
  h.resendVerification.mockResolvedValue({ success: true, data: undefined })
})
afterEach(cleanup)

describe('ResendVerification', () => {
  it('prefills the identifier it was given', () => {
    render(<ResendVerification defaultIdentifier="me@example.com" />)
    expect(screen.getByLabelText(/email or handle/i)).toHaveValue('me@example.com')
  })

  it('calls the action and then shows the ONE fixed message', async () => {
    render(<ResendVerification defaultIdentifier="me@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: /send another link/i }))
    await waitFor(() =>
      expect(h.resendVerification).toHaveBeenCalledWith({ identifier: 'me@example.com' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/if that account exists/i)
  })

  it('shows nothing before the first submit', () => {
    render(<ResendVerification />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the SAME fixed message even when the action rejects, and never a second one', async () => {
    // The guard against re-introducing the enumeration oracle. A component that
    // rendered anything distinguishable on failure would tell a caller which
    // addresses have accounts — which is the whole thing the action prevents.
    h.resendVerification.mockRejectedValue(new Error('transport exploded'))
    render(<ResendVerification defaultIdentifier="me@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: /send another link/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/if that account exists/i)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })
})
