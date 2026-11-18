import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  sendInviteEmail: vi.fn(),
  reqFindUnique: vi.fn(),
  reqFindMany: vi.fn(),
  reqUpdateMany: vi.fn(),
  codeCreate: vi.fn(),
  // Codes committed by a transaction. A throwing callback discards its creates.
  committed: [] as Record<string, unknown>[],
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/mail/send', () => ({ sendInviteEmail: h.sendInviteEmail }))
vi.mock('@/lib/db', () => {
  const prisma = {
    inviteRequest: { findUnique: h.reqFindUnique, findMany: h.reqFindMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const staged: Record<string, unknown>[] = []
      const tx = {
        inviteCode: {
          create: async (args: { data: Record<string, unknown> }) => {
            h.codeCreate(args)
            staged.push(args.data)
            return args.data
          },
        },
        inviteRequest: { updateMany: h.reqUpdateMany },
      }
      const result = await fn(tx)
      h.committed.push(...staged) // only reached when fn did not throw
      return result
    },
  }
  return { prisma }
})

import { inviteFromWaitlist } from '@/actions/waitlist'
import { listWaitlist } from '@/lib/demo/waitlist'

const ADMIN = { user: { id: 'a1', role: 'admin' } }

beforeEach(() => {
  vi.clearAllMocks()
  h.committed.length = 0
  h.sendInviteEmail.mockResolvedValue(true)
  h.reqFindUnique.mockResolvedValue({ id: 'r1', email: 'ann@example.com', invitedAt: null })
  h.reqUpdateMany.mockResolvedValue({ count: 1 })
  vi.stubEnv('RESEND_API_KEY', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('inviteFromWaitlist', () => {
  it('returns Not found and writes nothing for non-admins and signed-out callers', async () => {
    for (const session of [{ user: { id: 'u', role: 'learner' } }, { user: { id: 'u', role: 'staff' } }, null]) {
      h.auth.mockResolvedValue(session)
      expect(await inviteFromWaitlist('r1')).toEqual({ success: false, error: 'Not found' })
    }
    expect(h.codeCreate).not.toHaveBeenCalled()
    expect(h.reqUpdateMany).not.toHaveBeenCalled()
    expect(h.sendInviteEmail).not.toHaveBeenCalled()
  })

  it('mints exactly one single-use code and stamps the request', async () => {
    h.auth.mockResolvedValue(ADMIN)
    const res = await inviteFromWaitlist('r1')

    expect(res.success).toBe(true)
    expect(h.committed).toHaveLength(1)
    expect(h.committed[0]).toMatchObject({ maxUses: 1, usesRemaining: 1, label: 'waitlist: ann@example.com' })
    const stamp = h.reqUpdateMany.mock.calls[0][0]
    expect(stamp.where).toEqual({ id: 'r1', invitedAt: null })
    expect(stamp.data.invitedAt).toBeInstanceOf(Date)
    expect(stamp.data.inviteCode).toBe(h.committed[0].code)
    if (res.success) {
      expect(res.data.code).toBe(`${(h.committed[0].code as string).slice(0, 5)}-${(h.committed[0].code as string).slice(5)}`)
      expect(res.data.emailed).toBe(false) // no RESEND_API_KEY
    }
    expect(h.sendInviteEmail).toHaveBeenCalledWith('ann@example.com', expect.stringMatching(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/))
  })

  it('reports emailed only when a Resend key is configured and the send succeeded', async () => {
    h.auth.mockResolvedValue(ADMIN)
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const ok = await inviteFromWaitlist('r1')
    expect(ok.success && ok.data.emailed).toBe(true)

    h.sendInviteEmail.mockResolvedValue(false)
    const failed = await inviteFromWaitlist('r1')
    expect(failed.success && failed.data.emailed).toBe(false)
  })

  it('refuses a request that is already invited and mints nothing', async () => {
    h.auth.mockResolvedValue(ADMIN)
    h.reqFindUnique.mockResolvedValue({ id: 'r1', email: 'ann@example.com', invitedAt: new Date() })
    const res = await inviteFromWaitlist('r1')
    expect(res).toEqual({ success: false, error: 'Already invited' })
    expect(h.codeCreate).not.toHaveBeenCalled()
    expect(h.committed).toHaveLength(0)
  })

  it('rolls the mint back when a concurrent click wins the conditional stamp', async () => {
    h.auth.mockResolvedValue(ADMIN)
    h.reqUpdateMany.mockResolvedValue({ count: 0 }) // the other click stamped first
    const res = await inviteFromWaitlist('r1')
    expect(res).toEqual({ success: false, error: 'Already invited' })
    expect(h.codeCreate).toHaveBeenCalledTimes(1) // it tried to mint...
    expect(h.committed).toHaveLength(0) // ...but nothing survived: no orphan code
    expect(h.sendInviteEmail).not.toHaveBeenCalled()
  })

  it('returns Not found for an unknown request', async () => {
    h.auth.mockResolvedValue(ADMIN)
    h.reqFindUnique.mockResolvedValue(null)
    expect(await inviteFromWaitlist('nope')).toEqual({ success: false, error: 'Not found' })
  })

  it('never logs the raw code', async () => {
    h.auth.mockResolvedValue(ADMIN)
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')]
    await inviteFromWaitlist('r1')
    const raw = h.committed[0].code as string
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(raw)
    spies.forEach((s) => s.mockRestore())
  })
})

describe('listWaitlist', () => {
  it('pending excludes invited rows and orders newest first', async () => {
    h.reqFindMany.mockResolvedValue([])
    await listWaitlist('pending')
    expect(h.reqFindMany.mock.calls[0][0].where).toEqual({ invitedAt: null })
    expect(h.reqFindMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' })
  })

  it('invited keeps only invited rows; all applies no filter', async () => {
    h.reqFindMany.mockResolvedValue([])
    await listWaitlist('invited')
    expect(h.reqFindMany.mock.calls[0][0].where).toEqual({ invitedAt: { not: null } })
    await listWaitlist('all')
    expect(h.reqFindMany.mock.calls[1][0].where).toEqual({})
  })
})
