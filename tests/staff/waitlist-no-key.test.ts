import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The send module is deliberately NOT mocked: the console transport is the
// path that would print the code.
const h = vi.hoisted(() => ({ auth: vi.fn(), committed: [] as string[] }))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    inviteRequest: {
      findUnique: async () => ({ id: 'r1', email: 'ann@example.com', invitedAt: null }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        inviteCode: { create: async (a: { data: { code: string } }) => void h.committed.push(a.data.code) },
        inviteRequest: { updateMany: async () => ({ count: 1 }) },
      }),
  },
}))

import { inviteFromWaitlist } from '@/actions/waitlist'
import { sendInviteEmail } from '@/lib/mail/send'

beforeEach(() => {
  h.committed.length = 0
  h.auth.mockResolvedValue({ user: { id: 'a1', role: 'admin' } })
  vi.stubEnv('RESEND_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('invite without RESEND_API_KEY', () => {
  it('prints neither the raw nor the formatted code to any console method', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const res = await inviteFromWaitlist('r1')
    expect(res.success).toBe(true)
    const raw = h.committed[0]
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`
    const output = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    expect(output).not.toContain(raw)
    expect(output).not.toContain(formatted)
    expect(res.success && res.data.emailed).toBe(false)
  })

  it('sendInviteEmail returns false without sending', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await sendInviteEmail('ann@example.com', 'ABCDE-FGHJK')).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })
})
