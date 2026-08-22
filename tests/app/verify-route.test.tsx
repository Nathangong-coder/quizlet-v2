// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ consumeEmailVerification: vi.fn(), redirect: vi.fn() }))

// redirect() THROWS in Next, to unwind the render. The mock must too, or a
// try/catch wrapped around it would still look like a call and this guard
// would be incapable of failing.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    h.redirect(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))
vi.mock('@/actions/auth-verify', () => ({
  consumeEmailVerification: h.consumeEmailVerification,
  resendVerification: vi.fn(),
  RESEND_FIXED_MESSAGE: 'If that account exists, we’ve sent a link.',
}))

import VerifyPage from '@/app/verify/[token]/page'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('/verify/[token]', () => {
  it('redirects to /login?verified=1 on success, by THROWING out of the page', async () => {
    h.consumeEmailVerification.mockResolvedValue({ ok: true })
    await expect(VerifyPage({ params: Promise.resolve({ token: 'good' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/login?verified=1',
    )
    expect(h.redirect).toHaveBeenCalledWith('/login?verified=1')
  })

  it('renders the failure page with a resend control, and does NOT redirect', async () => {
    h.consumeEmailVerification.mockResolvedValue({ ok: false })
    render(await VerifyPage({ params: Promise.resolve({ token: 'dead' }) }))
    expect(h.redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /send another link/i })).toBeInTheDocument()
  })

  it('passes the DECODED token to the action', async () => {
    h.consumeEmailVerification.mockResolvedValue({ ok: false })
    render(await VerifyPage({ params: Promise.resolve({ token: 'a%2Bb' }) }))
    expect(h.consumeEmailVerification).toHaveBeenCalledWith('a+b')
  })

  it('a malformed token (undecodable) renders the failure page instead of throwing', async () => {
    h.consumeEmailVerification.mockResolvedValue({ ok: false })
    render(await VerifyPage({ params: Promise.resolve({ token: '%zz' }) }))
    expect(h.redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /send another link/i })).toBeInTheDocument()
  })
})
