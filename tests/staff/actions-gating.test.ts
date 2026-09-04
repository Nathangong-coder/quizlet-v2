import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), prisma: {} as Record<string, unknown> }))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: h.prisma }))

import * as staff from '@/actions/staff'

beforeEach(() => vi.clearAllMocks())

/**
 * Every export of a 'use server' module is an RPC endpoint. This asserts the
 * REFUSAL half: a gate proven to admit is worth little without one proven to
 * refuse. It calls every export generically, so a new action added later
 * without a gate fails here without anyone remembering to add a case.
 */
describe('src/actions/staff.ts refuses a learner on every export', () => {
  const exported = Object.entries(staff).filter(
    ([, v]) => typeof v === 'function',
  ) as [string, (arg?: unknown) => Promise<{ success: boolean; error?: string }>][]

  it('exports at least three actions', () => {
    expect(exported.length).toBeGreaterThanOrEqual(3)
  })

  for (const [name, fn] of exported) {
    it(`${name} returns Not found for a learner`, async () => {
      h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
      const res = await fn({})
      expect(res).toEqual({ success: false, error: 'Not found' })
    })

    it(`${name} returns Not found for a signed-out visitor`, async () => {
      h.auth.mockResolvedValue(null)
      const res = await fn({})
      expect(res).toEqual({ success: false, error: 'Not found' })
    })
  }
})
