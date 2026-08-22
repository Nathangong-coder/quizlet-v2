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
    render(<PasswordPanel hasPassword={false} />)
    fillNewAndConfirm(NEW, NEW)
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => expect(h.savePassword).toHaveBeenCalledWith({ current: undefined, next: NEW }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/login?callbackUrl=%2Faccount'))
  })

  it('does not navigate away when the save fails', async () => {
    h.savePassword.mockResolvedValue({ success: false, error: 'That current password is incorrect.' })
    render(<PasswordPanel hasPassword={true} />)
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
    render(<PasswordPanel hasPassword={false} />)
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: NEW } })
    expect(screen.getByRole('button', { name: /set password/i })).toBeDisabled()
  })

  it('only asks for the current password when one is already set', () => {
    const { unmount } = render(<PasswordPanel hasPassword={false} />)
    expect(screen.queryByLabelText(/current password/i)).toBeNull()
    unmount()

    render(<PasswordPanel hasPassword={true} />)
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
  })

  describe('recovery copy', () => {
    // The account now has a real recovery path via /forgot, so the panel
    // points there instead of stating (falsely) that there is no reset.
    it('points a forgetful user at the email reset flow', () => {
      render(<PasswordPanel hasPassword={true} />)
      const help = screen.getByText(/forgot it later/i)
      expect(help).toHaveTextContent(/reset it by email from the sign-in page/i)
      expect(help).not.toHaveTextContent(/no password reset/i)
    })
  })
})
