// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ savePassword: vi.fn(), push: vi.fn() }))

vi.mock('@/actions/password', () => ({ savePassword: h.savePassword }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PasswordPanel } from '@/components/account/PasswordPanel'

// RTL's auto-cleanup needs a global afterEach, which this repo doesn't
// register (vitest.config.ts has no `globals: true`).
afterEach(cleanup)

const NEW = 'n'.repeat(12)

beforeEach(() => {
  vi.clearAllMocks()
  h.savePassword.mockResolvedValue({ success: true, data: undefined })
})

function fillNewAndConfirm(next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/^password$|^new password$/i), {
    target: { value: next },
  })
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: confirm } })
}

describe('PasswordPanel', () => {
  it('sends the caller to /login on a successful save, since raising sessionVersion signs out the acting device too', async () => {
    // This is the fix for the bug where the success toast fired while the
    // stale token silently redirected the user to "/" with no explanation.
    render(<PasswordPanel hasPassword={false} hasGithub={true} />)
    fillNewAndConfirm(NEW, NEW)
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => expect(h.savePassword).toHaveBeenCalledWith({ current: undefined, next: NEW }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/login?callbackUrl=%2Faccount'))
  })

  it('does not navigate away when the save fails', async () => {
    h.savePassword.mockResolvedValue({ success: false, error: 'That current password is incorrect.' })
    render(<PasswordPanel hasPassword={true} hasGithub={true} />)
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'wrongwrongwrong' } })
    fillNewAndConfirm(NEW, NEW)
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/current password is incorrect/i)
    expect(h.push).not.toHaveBeenCalled()
  })

  it('disables submit while confirm is still empty, even with a valid new password typed', () => {
    // Without this, the first click on a half-filled form always produces
    // "Those passwords do not match" instead of doing nothing.
    render(<PasswordPanel hasPassword={false} hasGithub={true} />)
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: NEW } })
    expect(screen.getByRole('button', { name: /set password/i })).toBeDisabled()
  })

  it('only asks for the current password when one is already set', () => {
    const { unmount } = render(<PasswordPanel hasPassword={false} hasGithub={true} />)
    expect(screen.queryByLabelText(/current password/i)).toBeNull()
    unmount()

    render(<PasswordPanel hasPassword={true} hasGithub={true} />)
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
  })

  describe('recovery copy', () => {
    // A real discrimination, not a getByText on a string that renders
    // either way: each branch asserts the OTHER branch's claim is absent,
    // so a component that always renders one sentence fails one of the two.
    it('tells a GitHub-linked user GitHub is a way back in', () => {
      render(<PasswordPanel hasPassword={true} hasGithub={true} />)
      const help = screen.getByText(/no password reset yet/i)
      expect(help).toHaveTextContent(/GitHub is your way back in/i)
      expect(help).not.toHaveTextContent(/no way back into this account/i)
    })

    it('tells a credentials-only user plainly there is no way back in', () => {
      render(<PasswordPanel hasPassword={true} hasGithub={false} />)
      const help = screen.getByText(/no password reset yet/i)
      expect(help).toHaveTextContent(/no way back into this account/i)
      expect(help).not.toHaveTextContent(/GitHub is your way back in/i)
      expect(help).not.toHaveTextContent(/GitHub is the only way back in/i)
    })
  })
})
