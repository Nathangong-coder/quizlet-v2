import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { inviteCode: { create: h.create } } }))

import { mintInvite } from '@/lib/invites/mint'
import { INVITE_CODE_LENGTH } from '@/lib/invites/code'

beforeEach(() => {
  vi.clearAllMocks()
  h.create.mockResolvedValue({})
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-17T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('mintInvite', () => {
  it('sets expiresAt 14 days out and usesRemaining equal to maxUses', async () => {
    const { code } = await mintInvite({ uses: 1, days: 14, label: 'waitlist: a@b.co' })
    expect(code).toHaveLength(INVITE_CODE_LENGTH)
    const data = h.create.mock.calls[0][0].data
    expect(data.code).toBe(code)
    expect(data.maxUses).toBe(1)
    expect(data.usesRemaining).toBe(data.maxUses)
    expect(data.label).toBe('waitlist: a@b.co')
    expect(data.expiresAt).toEqual(new Date('2026-12-01T00:00:00Z'))
  })

  it('never expires when days is omitted, and defaults the label to null', async () => {
    await mintInvite({ uses: 5 })
    const data = h.create.mock.calls[0][0].data
    expect(data.expiresAt).toBeNull()
    expect(data.label).toBeNull()
    expect(data.usesRemaining).toBe(5)
  })

  it('writes through a supplied transaction client instead of the global one', async () => {
    const txCreate = vi.fn().mockResolvedValue({})
    await mintInvite({ uses: 1 }, { inviteCode: { create: txCreate } })
    expect(txCreate).toHaveBeenCalledTimes(1)
    expect(h.create).not.toHaveBeenCalled()
  })
})
