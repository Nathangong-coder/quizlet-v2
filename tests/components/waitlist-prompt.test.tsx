// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const requestInvite = vi.fn()
vi.mock('@/actions/demo', () => ({ requestInvite: (...a: unknown[]) => requestInvite(...a) }))

import { WaitlistPrompt } from '@/components/demo/WaitlistPrompt'

beforeEach(() => requestInvite.mockReset())
afterEach(cleanup)

function open(reason: React.ComponentProps<typeof WaitlistPrompt>['reason']) {
  render(<WaitlistPrompt open onOpenChange={() => {}} reason={reason} />)
}

function fill(email: string, note?: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  if (note !== undefined) fireEvent.change(screen.getByLabelText(/What are you preparing for\?/), { target: { value: note } })
  fireEvent.click(screen.getByRole('button', { name: 'Request an invite' }))
}

describe('WaitlistPrompt', () => {
  it('submitting calls requestInvite with the email and note and shows the success text', async () => {
    requestInvite.mockResolvedValue({ ok: true, data: {} })
    open('quota_used')
    fill('a@b.co', 'IB recruiting')
    expect(await screen.findByText("You're on the list. We'll email you an invite.")).toBeTruthy()
    expect(requestInvite).toHaveBeenCalledTimes(1)
    expect(requestInvite).toHaveBeenCalledWith({ email: 'a@b.co', note: 'IB recruiting' })
  })

  it('shows the one success text for every success, never an already-on-the-list text (R30)', async () => {
    requestInvite.mockResolvedValue({ ok: true, data: {} })
    open('cards')
    fill('a@b.co')
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe("You're on the list. We'll email you an invite.")
    expect(screen.queryByText(/already on the list/i)).toBeNull()
    expect(requestInvite).toHaveBeenCalledWith({ email: 'a@b.co' })
  })

  it('an invalid email shows an inline error and makes no call', () => {
    open('quota_used')
    fill('nope')
    expect(screen.getByRole('alert').textContent).toMatch(/email/i)
    expect(requestInvite).not.toHaveBeenCalled()
  })

  it("shows the server's message when the request is refused", async () => {
    requestInvite.mockResolvedValue({ ok: false, reason: 'rate_limited', message: 'Too many requests from here today. Try again tomorrow.' })
    open('invite')
    fill('a@b.co')
    expect(await screen.findByText('Too many requests from here today. Try again tomorrow.')).toBeTruthy()
  })

  it.each([
    ['demo_cap', 'The demo is busy today'],
    ['quota_used', "You've used your free try of this"],
    ['grade', "You've used your free try of this"],
    ['autocomplete', "You've used your free try of this"],
    ['cards', "You've reached the demo's limit"],
    ['quizzes', "You've reached the demo's limit"],
    ['invite', 'Request an invite'],
  ] as const)('reason %s has the heading %s', (reason, heading) => {
    open(reason)
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
  })

  it('lists what an account adds and links to sign up and sign in', () => {
    open('quizzes')
    expect(screen.getByText('Unlimited quizzes.')).toBeTruthy()
    expect(screen.getByText('Memory that brings back what you miss.')).toBeTruthy()
    expect(screen.getByText('Key points tested properly on your own cards.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/signup')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })

  it('renders nothing while closed', () => {
    render(<WaitlistPrompt open={false} onOpenChange={() => {}} reason="invite" />)
    expect(screen.queryByLabelText('Email')).toBeNull()
  })
})
