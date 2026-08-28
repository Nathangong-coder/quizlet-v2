import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    userId: 'u1' as string | null,
    sets: [] as { id: string; userId: string; visibility: string; publishedAt: Date | null }[],
    users: [] as { id: string; handle: string | null }[],
  }
  return {
    state,
    db: {
      set: {
        updateMany: vi.fn(async ({ where, data }: never) => {
          const w = where as { id: string; userId: string }
          const d = data as Record<string, unknown>
          const rows = state.sets.filter((s) => s.id === w.id && s.userId === w.userId)
          for (const r of rows) Object.assign(r, d)
          return { count: rows.length }
        }),
        findFirst: vi.fn(async ({ where }: never) => {
          const w = where as { id: string; userId: string }
          return state.sets.find((s) => s.id === w.id && s.userId === w.userId) ?? null
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: never) => {
          const w = where as { id: string }
          return state.users.find((u) => u.id === w.id) ?? null
        }),
      },
    },
  }
})

vi.mock('@/lib/db', () => ({ prisma: h.db }))
vi.mock('@/auth', () => ({
  auth: async () => (h.state.userId ? { user: { id: h.state.userId } } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setSetVisibility } from '@/actions/sets'

beforeEach(() => {
  h.state.userId = 'u1'
  h.state.sets = [{ id: 's1', userId: 'u1', visibility: 'private', publishedAt: null }]
  h.state.users = [{ id: 'u1', handle: null }]
})

describe('setSetVisibility', () => {
  it('allows private and link with no handle', async () => {
    for (const v of ['link', 'private'] as const) {
      const res = await setSetVisibility('s1', v)
      expect(res.success, v).toBe(true)
    }
  })

  it('REFUSES public when the owner has no handle', async () => {
    // Spec §3.3: /browse credits creators by handle, and a directory row with
    // no author is not shippable. This is the only act in the app that needs a
    // public identity — which is why handles stay optional everywhere else.
    const res = await setSetVisibility('s1', 'public')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toMatch(/handle/i)
    expect(h.state.sets[0].visibility).toBe('private')
  })

  it('allows public once a handle exists', async () => {
    h.state.users[0].handle = 'alice'
    const res = await setSetVisibility('s1', 'public')
    expect(res.success).toBe(true)
    expect(h.state.sets[0].visibility).toBe('public')
  })

  it('stamps publishedAt on the FIRST publish only', async () => {
    h.state.users[0].handle = 'alice'
    await setSetVisibility('s1', 'public')
    const first = h.state.sets[0].publishedAt
    expect(first).toBeInstanceOf(Date)

    await setSetVisibility('s1', 'link')
    await setSetVisibility('s1', 'public')
    // Republishing must not jump the set back to the front of the directory,
    // which sorts on publishedAt.
    expect(h.state.sets[0].publishedAt).toEqual(first)
  })

  it('rejects an unrecognised value rather than coercing it', async () => {
    const res = await setSetVisibility('s1', 'pubic')
    expect(res.success).toBe(false)
    expect(h.state.sets[0].visibility).toBe('private')
  })

  it('reports not-found for another user’s set', async () => {
    h.state.userId = 'u2'
    h.state.users.push({ id: 'u2', handle: 'bob' })
    const res = await setSetVisibility('s1', 'public')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toMatch(/not found/i)
  })
})
