import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The demo's "Request an invite" waitlist — a public, anonymous write.
 *
 * The inviteRequest table here is hand-rolled and honours what the code relies
 * on: the unique email (a duplicate create throws P2002) and the
 * (ipHash, createdAt >= day) count. Every method awaits before touching the
 * table, so two concurrent callers interleave step by step — the worst case
 * for check-then-act code.
 */
type Row = { id: string; email: string; note: string | null; source: string; ipHash: string; createdAt: Date; lastRequestedAt: Date }

const h = vi.hoisted(() => {
  const rows: Row[] = []
  const tick = () => Promise.resolve()
  let seq = 0
  const inviteRequest = {
    create: vi.fn(async ({ data }: { data: Partial<Row> & { email: string; ipHash: string } }) => {
      await tick()
      if (rows.some((r) => r.email === data.email)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      const now = new Date()
      const row: Row = {
        id: `r${++seq}`,
        note: null,
        source: 'demo',
        createdAt: now,
        lastRequestedAt: now,
        ...data,
      } as Row
      rows.push(row)
      return row
    }),
    update: vi.fn(async ({ where, data }: { where: { email: string }; data: Partial<Row> }) => {
      await tick()
      const row = rows.find((r) => r.email === where.email)
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' })
      Object.assign(row, data)
      return row
    }),
    count: vi.fn(async ({ where }: { where: { ipHash: string; createdAt: { gte: Date } } }) => {
      await tick()
      return rows.filter((r) => r.ipHash === where.ipHash && r.createdAt >= where.createdAt.gte).length
    }),
  }
  return {
    rows,
    inviteRequest,
    send: vi.fn(),
    guestContext: vi.fn(),
    afterTasks: [] as Array<() => unknown>,
  }
})

vi.mock('@/lib/db', () => ({ prisma: { inviteRequest: h.inviteRequest } }))
vi.mock('@/lib/mail/transport', () => ({
  consoleTransport: { send: h.send },
  resendTransport: () => ({ send: h.send }),
}))
// The callback is stored, not run: drainAfter() runs it, so the deferral is real.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void h.afterTasks.push(fn) }))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/demo/guest-context', () => ({ guestContext: h.guestContext }))
vi.mock('@/lib/demo/guard', () => ({ startRun: vi.fn(), reserveCall: vi.fn(), releaseCall: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({ generateJson: vi.fn(), resolveTaskModel: vi.fn(), AiGenerationError: class extends Error {} }))

import { normalizeEmail, recordInviteRequest } from '@/lib/demo/waitlist'
import { notifyOwner } from '@/lib/notify/owner'
import { ownerNotificationTemplate } from '@/lib/mail/templates'
import { requestInvite } from '@/actions/demo'

const drainAfter = () => Promise.all(h.afterTasks.splice(0).map((fn) => fn()))
const T0 = new Date('2026-11-17T10:00:00Z')
const CTX = {
  guestId: 'g1',
  ipHash: 'ip1',
  config: { enabled: true, setId: 'demo-set', aiUserId: 'operator', dailyCap: 1000, perIpFeatureLimit: 3, secret: 's' },
}

beforeEach(() => {
  h.rows.length = 0
  h.afterTasks.length = 0
  vi.clearAllMocks()
  h.send.mockResolvedValue(undefined)
  h.guestContext.mockResolvedValue(CTX)
  delete process.env.RESEND_API_KEY
  delete process.env.FEEDBACK_TO
})

describe('normalizeEmail', () => {
  it('trims and lower-cases a valid address', () => {
    expect(normalizeEmail('  A@B.co ')).toBe('a@b.co')
  })

  it('refuses something that is not an address', () => {
    expect(normalizeEmail('nope')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
  })

  it('refuses an address over 254 characters', () => {
    expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(186)}.com`)).toBeNull()
  })
})

describe('recordInviteRequest', () => {
  it('adds a new email', async () => {
    expect(await recordInviteRequest({ email: 'a@b.co', note: 'IB recruiting', ipHash: 'ip1' }, T0)).toEqual({ status: 'added' })
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ email: 'a@b.co', note: 'IB recruiting', ipHash: 'ip1', source: 'demo' })
  })

  it('a repeat email is already, keeps one row and moves lastRequestedAt', async () => {
    await recordInviteRequest({ email: 'a@b.co', note: null, ipHash: 'ip1' }, T0)
    const later = new Date(T0.getTime() + 60_000)
    expect(await recordInviteRequest({ email: 'a@b.co', note: null, ipHash: 'ip2' }, later)).toEqual({ status: 'already' })
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0].lastRequestedAt).toEqual(later)
    // The first requester's IP hash stays on the row.
    expect(h.rows[0].ipHash).toBe('ip1')
  })

  it('the 6th request from one IP in a UTC day is rate_limited', async () => {
    for (let i = 1; i <= 5; i++) {
      expect(await recordInviteRequest({ email: `u${i}@b.co`, note: null, ipHash: 'ip1' }, T0)).toEqual({ status: 'added' })
    }
    expect(await recordInviteRequest({ email: 'u6@b.co', note: null, ipHash: 'ip1' }, T0)).toEqual({ status: 'rate_limited' })
    expect(h.rows).toHaveLength(5)
    // Another IP is unaffected.
    expect(await recordInviteRequest({ email: 'u7@b.co', note: null, ipHash: 'ip2' }, T0)).toEqual({ status: 'added' })
  })

  it('the limit resets at the next UTC day', async () => {
    const yesterday = new Date('2026-11-16T23:30:00Z')
    for (let i = 1; i <= 5; i++) h.rows.push({ id: `old${i}`, email: `old${i}@b.co`, note: null, source: 'demo', ipHash: 'ip1', createdAt: yesterday, lastRequestedAt: yesterday })
    expect(await recordInviteRequest({ email: 'new@b.co', note: null, ipHash: 'ip1' }, T0)).toEqual({ status: 'added' })
  })

  it('two concurrent requests for the same new email do not throw: one added, one already', async () => {
    const results = await Promise.all([
      recordInviteRequest({ email: 'race@b.co', note: null, ipHash: 'ip1' }, T0),
      recordInviteRequest({ email: 'race@b.co', note: null, ipHash: 'ip1' }, T0),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['added', 'already'])
    expect(h.rows).toHaveLength(1)
  })

  it('an unexpected database error propagates', async () => {
    h.inviteRequest.create.mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'P1001' }))
    await expect(recordInviteRequest({ email: 'a@b.co', note: null, ipHash: 'ip1' }, T0)).rejects.toThrow('connection lost')
  })
})

describe('notifyOwner', () => {
  it('sends the waitlist request to the feedback recipient, reply-to the requester', async () => {
    process.env.FEEDBACK_TO = 'owner@example.com'
    await notifyOwner({ kind: 'waitlist_request', email: 'a@b.co', note: 'IB recruiting' })
    expect(h.send).toHaveBeenCalledTimes(1)
    const msg = h.send.mock.calls[0][0]
    expect(msg.to).toBe('owner@example.com')
    expect(msg.replyTo).toBe('a@b.co')
    expect(msg.text).toContain('a@b.co')
    expect(msg.text).toContain('IB recruiting')
  })

  it('resolves even when the transport throws', async () => {
    h.send.mockRejectedValue(new Error('smtp down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyOwner({ kind: 'waitlist_request', email: 'a@b.co', note: null })).resolves.toBeUndefined()
    spy.mockRestore()
  })
})

describe('ownerNotificationTemplate', () => {
  it('escapes the user-supplied note in the html and keeps the email out of the subject', () => {
    const body = ownerNotificationTemplate({ kind: 'waitlist_request', email: 'a@b.co', note: '<script>x</script>' })
    expect(body.html).not.toContain('<script>')
    expect(body.html).toContain('&lt;script&gt;')
    expect(body.subject).not.toContain('a@b.co')
  })
})

describe('requestInvite', () => {
  it('is demo_off with no write when the demo is off', async () => {
    h.guestContext.mockResolvedValue(null)
    const res = await requestInvite({ email: 'a@b.co' })
    expect(res).toMatchObject({ ok: false, reason: 'demo_off' })
    expect(h.inviteRequest.create).not.toHaveBeenCalled()
    expect(h.inviteRequest.count).not.toHaveBeenCalled()
  })

  it('an invalid email or an over-long note is invalid, with no write', async () => {
    expect(await requestInvite({ email: 'nope' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await requestInvite({ email: 'a@b.co', note: 'x'.repeat(201) })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await requestInvite({ email: 42 as unknown as string })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(h.inviteRequest.create).not.toHaveBeenCalled()
  })

  it('adds the normalized email with the guest IP hash and notifies the owner after the response', async () => {
    const res = await requestInvite({ email: '  A@B.co ', note: '  IB recruiting  ' })
    expect(res).toEqual({ ok: true, data: { status: 'added' } })
    expect(h.rows[0]).toMatchObject({ email: 'a@b.co', note: 'IB recruiting', ipHash: 'ip1' })
    // Deferred: nothing is sent until after() runs.
    expect(h.send).not.toHaveBeenCalled()
    await drainAfter()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][0].replyTo).toBe('a@b.co')
  })

  it('a blank note is stored as null', async () => {
    await requestInvite({ email: 'a@b.co', note: '   ' })
    expect(h.rows[0].note).toBeNull()
  })

  it('a repeat is already and does not notify the owner again', async () => {
    await requestInvite({ email: 'a@b.co' })
    await drainAfter()
    h.send.mockClear()
    expect(await requestInvite({ email: 'A@b.co' })).toEqual({ ok: true, data: { status: 'already' } })
    expect(h.afterTasks).toHaveLength(0)
    await drainAfter()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('the 6th request from one IP is refused as rate_limited, with no notification', async () => {
    for (let i = 1; i <= 5; i++) await requestInvite({ email: `u${i}@b.co` })
    h.afterTasks.length = 0
    expect(await requestInvite({ email: 'u6@b.co' })).toMatchObject({ ok: false, reason: 'rate_limited' })
    expect(h.afterTasks).toHaveLength(0)
  })

  it('a database failure is a generic failure and never logs the email', async () => {
    h.inviteRequest.create.mockRejectedValueOnce(new Error('Invalid `prisma.inviteRequest.create()` invocation: data: { email: "a@b.co" }'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await requestInvite({ email: 'a@b.co' })
    expect(res).toMatchObject({ ok: false })
    // An Error stringifies to {} — read its message, or this could never fail.
    const logged = spy.mock.calls.flat().map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a))).join(' ')
    expect(logged).not.toContain('a@b.co')
    spy.mockRestore()
  })
})
