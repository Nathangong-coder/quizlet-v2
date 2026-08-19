// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(cleanup)

const h = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), push: vi.fn(), refresh: vi.fn() }))

// A client component importing a server action pulls next-auth into jsdom and
// the file dies at load, before any test runs (BUILD-QUEUE trap 7).
vi.mock('@/actions/auth-signup', () => ({ signUp: h.signUp }))
vi.mock('next-auth/react', () => ({ signIn: h.signIn }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import SignUpForm from '@/components/auth/SignUpForm'

function fill(values: { handle?: string; email?: string; password?: string; confirm?: string }) {
  if (values.handle !== undefined)
    fireEvent.change(screen.getByLabelText(/handle/i), { target: { value: values.handle } })
  if (values.email !== undefined)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: values.email } })
  if (values.password !== undefined)
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: values.password } })
  if (values.confirm !== undefined)
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: values.confirm } })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.signUp.mockResolvedValue({ success: true, data: { email: 'alice@example.com' } })
  h.signIn.mockResolvedValue({ error: undefined })
})

describe('SignUpForm', () => {
  it('refuses to submit when the two passwords differ, without calling the action', async () => {
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'b'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(h.signUp).not.toHaveBeenCalled()
  })

  it('submits handle, email and password when they match', async () => {
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'a'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(h.signUp).toHaveBeenCalledWith({
        handle: 'alice',
        email: 'alice@example.com',
        password: 'a'.repeat(12),
      }),
    )
  })

  it('signs the new account straight in rather than leaving them at a form', async () => {
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'a'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith('credentials', {
        identifier: 'alice@example.com',
        password: 'a'.repeat(12),
        redirect: false,
      }),
    )
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/sets'))
  })

  it('shows the action’s error and does NOT sign in', async () => {
    h.signUp.mockResolvedValue({ success: false, error: 'Those details can’t be used.' })
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'a'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/can’t be used/i)).toBeInTheDocument()
    expect(h.signIn).not.toHaveBeenCalled()
  })

  it('renders the password fields as type=password', async () => {
    // A visible password field on a shared screen is the kind of defect nobody
    // reports and everybody notices.
    render(<SignUpForm />)
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/confirm/i)).toHaveAttribute('type', 'password')
  })
})
