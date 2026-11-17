import { beforeEach, describe, expect, it, vi } from 'vitest'

// A hand-rolled in-memory demoTicket table. It honours the conditions the guard
// relies on for atomicity (`calls: { lt }` / `{ gt }` on updateMany, the
// (guestId, feature) unique key on create), so the tests exercise real
// semantics rather than echoing a mock's canned answers. Every method awaits
// once before touching the table so concurrent callers interleave like they
// would against Postgres.
type Row = {
  id: string
  guestId: string
  ipHash: string
  feature: string
  calls: number
  createdAt: Date
}

const { table, demoTicket, nextId } = vi.hoisted(() => {
  const table: Row[] = []
  let seq = 0
  const nextId = (prefix: string) => `${prefix}${++seq}`
  const tick = () => Promise.resolve()

  type Where = {
    id?: string
    guestId?: string
    ipHash?: string
    feature?: string
    calls?: number | { lt?: number; gt?: number }
    createdAt?: { gte?: Date }
  }

  function matches(r: Row, w: Where = {}): boolean {
    if (w.id !== undefined && r.id !== w.id) return false
    if (w.guestId !== undefined && r.guestId !== w.guestId) return false
    if (w.ipHash !== undefined && r.ipHash !== w.ipHash) return false
    if (w.feature !== undefined && r.feature !== w.feature) return false
    if (typeof w.calls === 'number' && r.calls !== w.calls) return false
    if (typeof w.calls === 'object') {
      if (w.calls.lt !== undefined && !(r.calls < w.calls.lt)) return false
      if (w.calls.gt !== undefined && !(r.calls > w.calls.gt)) return false
    }
    if (w.createdAt?.gte !== undefined && r.createdAt < w.createdAt.gte) return false
    return true
  }

  const demoTicket = {
    async findUnique({
      where,
    }: {
      where: {
        id?: string
        guestId_feature?: { guestId: string; feature: string }
      }
    }) {
      await tick()
      const row = where.guestId_feature
        ? table.find(
            (r) => r.guestId === where.guestId_feature!.guestId && r.feature === where.guestId_feature!.feature,
          )
        : table.find((r) => r.id === where.id)
      return row ? { ...row } : null
    },
    async create({
      data,
    }: {
      data: Omit<Row, 'id' | 'calls' | 'createdAt'> & {
        calls?: number
        createdAt?: Date
      }
    }) {
      await tick()
      if (table.some((r) => r.guestId === data.guestId && r.feature === data.feature)) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        })
      }
      const row: Row = {
        id: nextId('t'),
        calls: 0,
        createdAt: new Date(),
        ...data,
      }
      table.push(row)
      return { ...row }
    },
    async count({ where }: { where?: Where }) {
      await tick()
      return table.filter((r) => matches(r, where)).length
    },
    async aggregate({ where }: { where?: Where; _sum: { calls: true } }) {
      await tick()
      const rows = table.filter((r) => matches(r, where))
      return {
        _sum: {
          calls: rows.length ? rows.reduce((s, r) => s + r.calls, 0) : null,
        },
      }
    },
    async updateMany({ where, data }: { where: Where; data: { calls: { increment?: number; decrement?: number } } }) {
      await tick()
      const rows = table.filter((r) => matches(r, where))
      for (const r of rows) r.calls += (data.calls.increment ?? 0) - (data.calls.decrement ?? 0)
      return { count: rows.length }
    },
    async deleteMany({ where }: { where: Where }) {
      await tick()
      let count = 0
      for (let i = table.length - 1; i >= 0; i--) {
        if (matches(table[i], where)) {
          table.splice(i, 1)
          count++
        }
      }
      return { count }
    },
  }

  return { table, demoTicket, nextId }
})

vi.mock('@/lib/db', () => ({ prisma: { demoTicket } }))

import { releaseCall, reserveCall, startRun, type GuestCtx } from '@/lib/demo/guard'
import { readDemoConfig } from '@/lib/demo/config'

const NOW = new Date('2026-11-17T12:00:00Z')
const YESTERDAY = new Date('2026-11-16T12:00:00Z')

function ctx(guestId = 'guest-a', ipHash = 'ip-1', overrides: Partial<GuestCtx['config']> = {}): GuestCtx {
  const config = {
    ...readDemoConfig({
      DEMO_ENABLED: 'true',
      DEMO_SET_ID: 'set',
      DEMO_AI_USER_ID: 'ai',
      AUTH_SECRET: 'secret',
    }),
    ...overrides,
  }
  return { guestId, ipHash, config }
}

function seed(row: Partial<Row> & Pick<Row, 'guestId' | 'feature'>) {
  table.push({
    id: nextId('seed'),
    ipHash: 'ip-seed',
    calls: 0,
    createdAt: NOW,
    ...row,
  })
}

beforeEach(() => {
  table.length = 0
})

describe('grade (one-shot)', () => {
  it('allows one call, then refuses', async () => {
    const c = ctx()
    expect(await reserveCall(c, 'grade', NOW)).toMatchObject({ ok: true })
    expect(await reserveCall(c, 'grade', NOW)).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
  })

  it('refunds on release: the ticket is deleted and the guest may retry', async () => {
    const c = ctx()
    const first = await reserveCall(c, 'grade', NOW)
    if (!first.ok) throw new Error('expected ok')
    await releaseCall(first.ticketId, 'grade')
    expect(table).toHaveLength(0)
    expect(await reserveCall(c, 'grade', NOW)).toMatchObject({ ok: true })
  })

  it('a double click produces exactly one reservation', async () => {
    const c = ctx()
    const results = await Promise.all([reserveCall(c, 'grade', NOW), reserveCall(c, 'grade', NOW)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, refusal: 'quota_used' }])
    expect(table).toHaveLength(1)
    expect(table[0].calls).toBe(1)
  })

  it('release never drives calls below zero', async () => {
    const c = ctx()
    const first = await reserveCall(c, 'grade', NOW)
    if (!first.ok) throw new Error('expected ok')
    await Promise.all([releaseCall(first.ticketId, 'grade'), releaseCall(first.ticketId, 'grade')])
    expect(table).toHaveLength(0)
  })
})

describe('klp-extract (ceiling 5)', () => {
  it('allows five calls and refuses the sixth', async () => {
    const c = ctx()
    for (let i = 0; i < 5; i++)
      expect(await reserveCall(c, 'klp-extract', NOW)).toMatchObject({
        ok: true,
      })
    expect(await reserveCall(c, 'klp-extract', NOW)).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
  })
})

describe('gauntlet (run feature)', () => {
  it('refuses a reservation before the run starts', async () => {
    expect(await reserveCall(ctx(), 'gauntlet', NOW)).toEqual({
      ok: false,
      refusal: 'run_not_started',
    })
    expect(table).toHaveLength(0)
  })

  it('allows 12 calls in a run and refuses the 13th', async () => {
    const c = ctx()
    expect(await startRun(c, 'gauntlet', NOW)).toEqual({ ok: true })
    for (let i = 0; i < 12; i++) expect(await reserveCall(c, 'gauntlet', NOW)).toMatchObject({ ok: true })
    expect(await reserveCall(c, 'gauntlet', NOW)).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
  })

  it('refuses a second run', async () => {
    const c = ctx()
    expect(await startRun(c, 'gauntlet', NOW)).toEqual({ ok: true })
    expect(await startRun(c, 'gauntlet', NOW)).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
  })

  it('a concurrent double start opens exactly one run', async () => {
    const c = ctx()
    const results = await Promise.all([startRun(c, 'gauntlet', NOW), startRun(c, 'gauntlet', NOW)])
    expect(results).toContainEqual({ ok: true })
    expect(results).toContainEqual({ ok: false, refusal: 'quota_used' })
    expect(table).toHaveLength(1)
  })

  it('refuses a reservation 31 minutes after the start', async () => {
    const c = ctx()
    await startRun(c, 'gauntlet', NOW)
    expect(await reserveCall(c, 'gauntlet', new Date(NOW.getTime() + 29 * 60_000))).toMatchObject({ ok: true })
    expect(await reserveCall(c, 'gauntlet', new Date(NOW.getTime() + 31 * 60_000))).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
  })

  it('release refunds the call but never deletes a run ticket', async () => {
    const c = ctx()
    await startRun(c, 'gauntlet', NOW)
    const r = await reserveCall(c, 'gauntlet', NOW)
    if (!r.ok) throw new Error('expected ok')
    await releaseCall(r.ticketId, 'gauntlet')
    await releaseCall(r.ticketId, 'gauntlet')
    expect(table).toHaveLength(1)
    expect(table[0].calls).toBe(0)
  })

  it('startRun refuses a non-run feature', async () => {
    expect(await startRun(ctx(), 'grade', NOW)).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
    expect(table).toHaveLength(0)
  })
})

describe('per-IP limit', () => {
  it('lets three guests on one IP open grade and refuses the fourth', async () => {
    for (const g of ['g1', 'g2', 'g3']) {
      expect(await reserveCall(ctx(g, 'ip-shared'), 'grade', NOW)).toMatchObject({ ok: true })
    }
    expect(await reserveCall(ctx('g4', 'ip-shared'), 'grade', NOW)).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
    // A different IP is unaffected.
    expect(await reserveCall(ctx('g5', 'ip-other'), 'grade', NOW)).toMatchObject({ ok: true })
  })

  it("doesn't count yesterday's tickets", async () => {
    for (const g of ['old1', 'old2', 'old3'])
      seed({
        guestId: g,
        ipHash: 'ip-shared',
        feature: 'grade',
        calls: 1,
        createdAt: YESTERDAY,
      })
    expect(await reserveCall(ctx('g1', 'ip-shared'), 'grade', NOW)).toMatchObject({ ok: true })
  })

  it('counts per feature', async () => {
    for (const g of ['g1', 'g2', 'g3']) seed({ guestId: g, ipHash: 'ip-shared', feature: 'grade', calls: 1 })
    expect(await reserveCall(ctx('g4', 'ip-shared'), 'klp-extract', NOW)).toMatchObject({ ok: true })
  })

  it('applies to startRun', async () => {
    for (const g of ['g1', 'g2', 'g3'])
      expect(await startRun(ctx(g, 'ip-shared'), 'hot-seat', NOW)).toEqual({
        ok: true,
      })
    expect(await startRun(ctx('g4', 'ip-shared'), 'hot-seat', NOW)).toEqual({
      ok: false,
      refusal: 'quota_used',
    })
  })
})

describe('global daily cap', () => {
  it('refuses every feature once the day has spent the cap', async () => {
    seed({ guestId: 'x', feature: 'klp-extract', calls: 2 })
    const c = ctx('fresh', 'ip-fresh', { dailyCap: 2 })
    for (const f of ['grade', 'klp-extract', 'autocomplete', 'gauntlet', 'hot-seat'] as const) {
      expect(await reserveCall(c, f, NOW)).toEqual({
        ok: false,
        refusal: 'demo_cap',
      })
    }
  })

  it("doesn't count yesterday's calls", async () => {
    seed({
      guestId: 'x',
      feature: 'klp-extract',
      calls: 5,
      createdAt: YESTERDAY,
    })
    expect(await reserveCall(ctx('fresh', 'ip-fresh', { dailyCap: 2 }), 'grade', NOW)).toMatchObject({ ok: true })
  })

  it('reports demo_cap ahead of a used ticket', async () => {
    const c = ctx('g', 'ip', { dailyCap: 2 })
    expect(await reserveCall(c, 'grade', NOW)).toMatchObject({ ok: true })
    seed({ guestId: 'x', feature: 'klp-extract', calls: 1 })
    expect(await reserveCall(c, 'grade', NOW)).toEqual({
      ok: false,
      refusal: 'demo_cap',
    })
  })
})
