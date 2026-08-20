// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(cleanup)

const h = vi.hoisted(() => ({ signIn: vi.fn(), push: vi.fn(), refresh: vi.fn() }))

vi.mock('next-auth/react', () => ({ signIn: h.signIn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))

import LoginForm from '@/components/auth/LoginForm'

beforeEach(() => {
  vi.clearAllMocks()
  h.signIn.mockResolvedValue({ error: undefined })
})

function fill(identifier: string, password: string) {
  fireEvent.change(screen.getByLabelText(/email or handle/i), { target: { value: identifier } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } })
}

describe('LoginForm', () => {
  it('signs in and lands on the callback url', async () => {
    render(<LoginForm callbackUrl="/sets/abc/quiz" signupOpen={false} />)
    fill('alice', 'a'.repeat(12))
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith('credentials', {
        identifier: 'alice',
        password: 'a'.repeat(12),
        redirect: false,
      }),
    )
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/sets/abc/quiz'))
  })

  it('shows ONE generic message on a failed sign-in', async () => {
    // Distinguishing "no such account" from "wrong password" is a
    // user-enumeration oracle. This assertion is the UI half of that rule.
    h.signIn.mockResolvedValue({ error: 'CredentialsSignin' })
    render(<LoginForm callbackUrl="/sets" signupOpen={false} />)
    fill('alice', 'wrongwrongwrong')
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/email or password is incorrect/i)
    expect(alert).not.toHaveTextContent(/no account|not found|unknown|no such/i)
    expect(h.push).not.toHaveBeenCalled()
  })

  it('explains OAuthAccountNotLinked instead of showing the raw code', async () => {
    // The real dead end from design §7: someone signed up by password, then
    // tried GitHub with the same address. Auth.js refuses — correctly — and
    // without this copy the user sees an opaque error string.
    render(<LoginForm callbackUrl="/sets" signupOpen={false} initialError="OAuthAccountNotLinked" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/already/i)
    expect(alert).not.toHaveTextContent('OAuthAccountNotLinked')
    // There is no account-linking UI anywhere in this app and none is
    // planned, so the copy must not promise one.
    expect(alert).not.toHaveTextContent(/link github later/i)
  })

  it('offers the GitHub route as well', async () => {
    render(<LoginForm callbackUrl="/sets" signupOpen={false} />)
    fireEvent.click(screen.getByRole('button', { name: /github/i }))
    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith('github', { callbackUrl: '/sets' }),
    )
  })

  it('hides the sign-up link when sign-up is closed, and shows it when open', () => {
    // A link to a route that 404s is worse than no link.
    const { unmount } = render(<LoginForm callbackUrl="/sets" signupOpen={false} />)
    expect(screen.queryByRole('link', { name: /create an account/i })).toBeNull()
    unmount()

    render(<LoginForm callbackUrl="/sets" signupOpen={true} />)
    expect(screen.getByRole('link', { name: /create an account/i })).toBeInTheDocument()
  })
})
