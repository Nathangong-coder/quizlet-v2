import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  send: vi.fn(),
  /** Captures the `after()` callback so a test can run it deliberately. */
  afterCallbacks: [] as Array<() => unknown>,
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: { feedback: { create: h.create, update: h.update, count: h.count } },
}))
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.afterCallbacks.push(fn)
  },
}))
vi.mock('@/lib/mail/send', () => ({ sendFeedbackEmail: h.send }))

import { submitFeedback } from '@/actions/feedback'
import { FEEDBACK_MAX_PER_HOUR } from '@/lib/feedback/rate'

const valid = {
  name: 'Alice',
  email: 'alice@example.com',
  subject: 'The timer',
  message: 'It keeps running after I finish.',
}

/** Run whatever `after()` was handed, the way the runtime would. */
async function flushAfter() {
  const queued = [...h.afterCallbacks]
  h.afterCallbacks.length = 0
  for (const fn of queued) await fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterCallbacks.length = 0
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.count.mockResolvedValue(0)
  h.create.mockResolvedValue({ id: 'f1' })
  h.update.mockResolvedValue({})
  h.send.mockResolvedValue(true)
})

describe('submitFeedback', () => {
  it('refuses a signed-out caller and writes nothing', async () => {
    h.auth.mockResolvedValue(null)
    const res = await submitFeedback(valid)
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('takes the user id from the SESSION, never from the input', async () => {
    // Every export in a `'use server'` file is a public endpoint. If the id
    // came from the payload, any caller could file a report as anyone.
    await submitFeedback({ ...valid, userId: 'somebody-else' } as never)
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
    )
  })

  it('does not persist a client-supplied userId field at all', async () => {
    await submitFeedback({ ...valid, userId: 'somebody-else' } as never)
    const data = h.create.mock.calls[0][0].data
    expect(data.userId).toBe('u1')
  })

  it('rejects an invalid payload before touching the database', async () => {
    const res = await submitFeedback({ ...valid, email: 'not-an-address' })
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('WRITES THE ROW EVEN WHEN MAIL FAILS OUTRIGHT', async () => {
    // THE REASON THE Feedback TABLE EXISTS. `sendFeedbackEmail` is documented
    // never to throw, but if a future edit lets one escape — or if the send
    // simply reports failure — the message must already be safe on disk.
    // RESEND_API_KEY is absent in development, so "mail did not go out" is the
    // DEFAULT state here, not an edge case.
    h.send.mockRejectedValue(new Error('resend is down'))

    const res = await submitFeedback(valid)
    expect(res.success).toBe(true)
    expect(h.create).toHaveBeenCalledTimes(1)

    await expect(flushAfter()).rejects.toThrow('resend is down')
    // The row is still there, and was never marked delivered.
    expect(h.update).not.toHaveBeenCalled()
  })

  it('creates the row BEFORE attempting delivery', async () => {
    // Ordering, asserted directly rather than inferred. `after()` is captured
    // rather than executed, so if the send were moved ahead of the create it
    // would have run by the time this assertion looks.
    await submitFeedback(valid)
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('marks the row delivered only once the send reports success', async () => {
    await submitFeedback(valid)
    expect(h.update).not.toHaveBeenCalled()

    await flushAfter()
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { delivered: true } })
  })

  it('leaves delivered false when the send reports failure', async () => {
    h.send.mockResolvedValue(false)
    await submitFeedback(valid)
    await flushAfter()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('does not let a failed "mark delivered" escape after()', async () => {
    // `after()` has no error boundary; an escaped rejection there is an
    // unhandled one. The message is already stored AND already sent by this
    // point, so the flag is the least consequential thing that can fail.
    h.update.mockRejectedValue(new Error('db blip'))
    await submitFeedback(valid)
    await expect(flushAfter()).resolves.toBeUndefined()
  })

  it('refuses past the rate limit without writing', async () => {
    h.count.mockResolvedValue(FEEDBACK_MAX_PER_HOUR)
    const res = await submitFeedback(valid)
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('allows the message that sits exactly at the limit boundary', async () => {
    h.count.mockResolvedValue(FEEDBACK_MAX_PER_HOUR - 1)
    const res = await submitFeedback(valid)
    expect(res.success).toBe(true)
  })

  it('counts only this user, inside the window', async () => {
    await submitFeedback(valid)
    const where = h.count.mock.calls[0][0].where
    expect(where.userId).toBe('u1')
    expect(where.createdAt.gte).toBeInstanceOf(Date)
  })

  it('stores the TRIMMED values the schema produced, not the raw input', async () => {
    await submitFeedback({ ...valid, name: '  Alice  ' })
    expect(h.create.mock.calls[0][0].data.name).toBe('Alice')
  })
})
