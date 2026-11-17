import { beforeEach, describe, expect, it, vi } from 'vitest'

// A hand-rolled in-memory demoTicket table. It honours the conditions the guard
// relies on for atomicity (`{ lt }` / `{ gt }` on updateMany and deleteMany, the
// (guestId, feature) unique key on create), so the tests exercise real
// semantics rather than echoing a mock's canned answers. Every method awaits
// once before touching the table, so concurrent callers (Promise.all)
// interleave step by step — the worst case for check-then-act code.
type Row = {
  id: string
  guestId: string
  ipHash: string
  feature: string
  calls: number
  spent: number
  admitted: boolean
  createdAt: Date
}

const { table, demoTicket, nextId } = vi.hoisted(() => {
  const table: Row[] = []
  let seq = 0
  const nextId = (prefix: string) => `${prefix}${++seq}`
  const tick = () => Promise.resolve()

  type Num = number | { lt?: number; gt?: number }
  type Where = {
    id?: string
    guestId?: string
    ipHash?: string
    feature?: string
    calls?: Num
    spent?: Num
    admitted?: boolean
    createdAt?: { gte?: Date; lte?: Date }
  }
  type Step = { increment?: number; decrement?: number }

  function num(value: number, cond: Num | undefined): boolean {
    if (cond === undefined) return true
    if (typeof cond === 'number') return value === cond
    if (cond.lt !== undefined && !(value < cond.lt)) return false
    if (cond.gt !== undefined && !(value > cond.gt)) return false
    return true
  }

  function matches(r: Row, w: Where = {}): boolean {
    if (w.id !== undefined && r.id !== w.id) return false
    if (w.guestId !== undefined && r.guestId !== w.guestId) return false
    if (w.ipHash !== undefined && r.ipHash !== w.ipHash) return false
    if (w.feature !== undefined && r.feature !== w.feature) return false
    if (!num(r.calls, w.calls) || !num(r.spent, w.spent)) return false
    if (w.admitted !== undefined && r.admitted !== w.admitted) return false
    if (w.createdAt?.gte !== undefined && r.createdAt < w.createdAt.gte) return false
    if (w.createdAt?.lte !== undefined && r.createdAt > w.createdAt.lte) return false
    return true
  }

  const step = (s: Step | undefined) => (s?.increment ?? 0) - (s?.decrement ?? 0)

  const demoTicket = {
    async findUnique({ where }: { where: { id?: string; guestId_feature?: { guestId: string; feature: string } } }) {
      await tick()
      const key = where.guestId_feature
      const row = key
        ? table.find((r) => r.guestId === key.guestId && r.feature === key.feature)
        : table.find((r) => r.id === where.id)
      return row ? { ...row } : null
    },
    async create({ data }: { data: Pick<Row, 'guestId' | 'ipHash' | 'feature'> & Partial<Row> }) {
      await tick()
      if (table.some((r) => r.guestId === data.guestId && r.feature === data.feature)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      }
      const row: Row = { id: nextId('t'), calls: 0, spent: 0, admitted: false, createdAt: new Date(), ...data }
      table.push(row)
      return { ...row }
    },
    async count({ where }: { where?: Where }) {
      await tick()
      return table.filter((r) => matches(r, where)).length
    },
    async aggregate({ where }: { where?: Where; _sum: { spent: true } }) {
      await tick()
      const rows = table.filter((r) => matches(r, where))
      return { _sum: { spent: rows.length ? rows.reduce((s, r) => s + r.spent, 0) : null } }
    },
    async updateMany({ where, data }: { where: Where; data: { calls?: Step; spent?: Step; admitted?: boolean } }) {
      await tick()
      const rows = table.filter((r) => matches(r, where))
      for (const r of rows) {
        r.calls += step(data.calls)
        r.spent += step(data.spent)
        if (data.admitted !== undefined) r.admitted = data.admitted
      }
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
const at = (ms: number) => new Date(NOW.getTime() + ms)

function ctx(guestId = 'guest-a', ipHash = 'ip-1', overrides: Partial<GuestCtx['config']> = {}): GuestCtx {
  const config = {
    ...readDemoConfig({ DEMO_ENABLED: 'true', DEMO_SET_ID: 'set', DEMO_AI_USER_ID: 'ai', AUTH_SECRET: 'secret' }),
    ...overrides,
  }
  return { guestId, ipHash, config }
}

// Seeded tickets default to admitted: they passed the per-IP limit when they opened.
function seed(row: Partial<Row> & Pick<Row, 'guestId' | 'feature'>) {
  table.push({ id: nextId('seed'), ipHash: 'ip-seed', calls: 0, spent: 0, admitted: true, createdAt: NOW, ...row })
}

const ticketOf = (guestId: string, feature: string) => table.find((r) => r.guestId === guestId && r.feature === feature)
const QUOTA = { ok: false, refusal: 'quota_used' }
const CAP = { ok: false, refusal: 'demo_cap' }

beforeEach(() => {
  table.length = 0
})

describe('grade (one-shot)', () => {
  it('allows one call, then refuses', async () => {
    const c = ctx()
    expect(await reserveCall(c, 'grade', NOW)).toMatchObject({ ok: true })
    expect(await reserveCall(c, 'grade', NOW)).toEqual(QUOTA)
  })

  it('refunds on release: the ticket survives and the guest may retry, but spent keeps counting', async () => {
    const c = ctx()
    const first = await reserveCall(c, 'grade', NOW)
    if (!first.ok) throw new Error('expected ok')
    await releaseCall(first.ticketId, 'grade')
    expect(await reserveCall(c, 'grade', NOW)).toMatchObject({ ok: true })
    expect(table).toHaveLength(1)
    expect(ticketOf('guest-a', 'grade')).toMatchObject({ calls: 1, spent: 2 })
  })

  it('a double click produces exactly one reservation', async () => {
    const c = ctx()
    const results = await Promise.all([reserveCall(c, 'grade', NOW), reserveCall(c, 'grade', NOW)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([QUOTA])
    expect(table).toHaveLength(1)
    expect(table[0]).toMatchObject({ calls: 1, spent: 1 })
  })

  it('release never drives calls below zero and never deletes', async () => {
    const c = ctx()
    const first = await reserveCall(c, 'grade', NOW)
    if (!first.ok) throw new Error('expected ok')
    await Promise.all([releaseCall(first.ticketId, 'grade'), releaseCall(first.ticketId, 'grade')])
    expect(table).toHaveLength(1)
    expect(table[0]).toMatchObject({ calls: 0, spent: 1 })
  })
})

describe('klp-extract (ceiling 5)', () => {
  it('allows five calls and refuses the sixth', async () => {
    const c = ctx()
    for (let i = 0; i < 5; i++) expect(await reserveCall(c, 'klp-extract', NOW)).toMatchObject({ ok: true })
    expect(await reserveCall(c, 'klp-extract', NOW)).toEqual(QUOTA)
  })

  it('two reservations then one release leaves the ticket at calls = 1', async () => {
    const c = ctx()
    const a = await reserveCall(c, 'klp-extract', NOW)
    await reserveCall(c, 'klp-extract', NOW)
    if (!a.ok) throw new Error('expected ok')
    await releaseCall(a.ticketId, 'klp-extract')
    expect(ticketOf('guest-a', 'klp-extract')).toMatchObject({ calls: 1, spent: 2 })
  })
})

describe('gauntlet (run feature)', () => {
  it('refuses a reservation before the run starts', async () => {
    expect(await reserveCall(ctx(), 'gauntlet', NOW)).toEqual({ ok: false, refusal: 'run_not_started' })
    expect(table).toHaveLength(0)
  })

  it('allows 12 calls in a run and refuses the 13th', async () => {
    const c = ctx()
    expect(await startRun(c, 'gauntlet', NOW)).toEqual({ ok: true })
    for (let i = 0; i < 12; i++) expect(await reserveCall(c, 'gauntlet', NOW)).toMatchObject({ ok: true })
    expect(await reserveCall(c, 'gauntlet', NOW)).toEqual(QUOTA)
  })

  it('refuses a second run', async () => {
    const c = ctx()
    expect(await startRun(c, 'gauntlet', NOW)).toEqual({ ok: true })
    expect(await startRun(c, 'gauntlet', NOW)).toEqual(QUOTA)
  })

  it('a concurrent double start opens exactly one run', async () => {
    const c = ctx()
    const results = await Promise.all([startRun(c, 'gauntlet', NOW), startRun(c, 'gauntlet', NOW)])
    expect(results).toContainEqual({ ok: true })
    expect(results).toContainEqual(QUOTA)
    expect(table).toHaveLength(1)
  })

  it('refuses a reservation 31 minutes after the start', async () => {
    const c = ctx()
    await startRun(c, 'gauntlet', NOW)
    expect(await reserveCall(c, 'gauntlet', at(29 * 60_000))).toMatchObject({ ok: true })
    expect(await reserveCall(c, 'gauntlet', at(31 * 60_000))).toEqual(QUOTA)
  })

  it('release refunds the call but never deletes a run ticket', async () => {
    const c = ctx()
    await startRun(c, 'gauntlet', NOW)
    const r = await reserveCall(c, 'gauntlet', NOW)
    if (!r.ok) throw new Error('expected ok')
    await releaseCall(r.ticketId, 'gauntlet')
    await releaseCall(r.ticketId, 'gauntlet')
    expect(table).toHaveLength(1)
    expect(table[0]).toMatchObject({ calls: 0, spent: 1 })
  })

  it('startRun refuses a non-run feature', async () => {
    expect(await startRun(ctx(), 'grade', NOW)).toEqual(QUOTA)
    expect(table).toHaveLength(0)
  })
})

describe('per-IP limit', () => {
  it('lets three guests on one IP open grade and refuses the fourth', async () => {
    for (const g of ['g1', 'g2', 'g3']) {
      expect(await reserveCall(ctx(g, 'ip-shared'), 'grade', NOW)).toMatchObject({ ok: true })
    }
    expect(await reserveCall(ctx('g4', 'ip-shared'), 'grade', NOW)).toEqual(QUOTA)
    expect(ticketOf('g4', 'grade')).toBeUndefined()
    expect(table.every((r) => r.admitted)).toBe(true)
    // A different IP is unaffected.
    expect(await reserveCall(ctx('g5', 'ip-other'), 'grade', NOW)).toMatchObject({ ok: true })
  })

  it('a concurrent burst of four fresh guests on one IP gets at most three calls', async () => {
    const results = await Promise.all(
      ['g1', 'g2', 'g3', 'g4'].map((g) => reserveCall(ctx(g, 'ip-shared'), 'grade', NOW)),
    )
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(3)
    expect(results.filter((r) => !r.ok).every((r) => r.refusal === 'quota_used')).toBe(true)
    expect(table.reduce((s, r) => s + r.spent, 0)).toBeLessThanOrEqual(3)
  })

  it('a concurrent burst with distinct entry stamps also gets at most three calls', async () => {
    // A plain count may over-refuse a race (here every insert lands before any
    // count, so all four see 4); it never over-admits.
    const results = await Promise.all(
      ['g1', 'g2', 'g3', 'g4'].map((g, i) => reserveCall(ctx(g, 'ip-shared'), 'grade', at(i))),
    )
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(3)
    expect(table.reduce((s, r) => s + r.spent, 0)).toBeLessThanOrEqual(3)
  })

  it('out-of-order arrivals (entry stamps decreasing) still serve at most three', async () => {
    // Each request entered earlier than the last but inserted later: a rank by
    // entry stamp sees every one of them as first.
    const results = []
    for (let i = 0; i < 6; i++) results.push(await reserveCall(ctx(`g${i}`, 'ip-shared'), 'grade', at(10 - i)))
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(3)
    expect(table.reduce((s, r) => s + r.spent, 0)).toBeLessThanOrEqual(3)
  })

  it('never spends a ticket that is not admitted yet, even for its own guest', async () => {
    // Another request from g4 has inserted g4's ticket but not yet admitted it.
    seed({ guestId: 'g4', ipHash: 'ip-shared', feature: 'grade', admitted: false })
    expect(await reserveCall(ctx('g4', 'ip-shared'), 'grade', NOW)).toEqual(QUOTA)
    expect(ticketOf('g4', 'grade')).toMatchObject({ calls: 0, spent: 0, admitted: false })
  })

  it('a concurrent same-guest request cannot spend a ticket whose opener is refused', async () => {
    // The IP is at its limit, so g4's opener will discard g4's new ticket; the
    // second request (which finds or collides with that ticket) must not spend it.
    for (const g of ['g1', 'g2', 'g3'])
      seed({ guestId: g, ipHash: 'ip-shared', feature: 'klp-extract', calls: 1, spent: 1 })
    const c = ctx('g4', 'ip-shared')
    const results = await Promise.all([reserveCall(c, 'klp-extract', NOW), reserveCall(c, 'klp-extract', NOW)])
    expect(results).toEqual([QUOTA, QUOTA])
    expect(ticketOf('g4', 'klp-extract')).toBeUndefined()
    expect(table.reduce((s, r) => s + r.spent, 0)).toBe(3)
  })

  it('an admitted ticket is not re-checked against the IP limit', async () => {
    seed({ guestId: 'g1', ipHash: 'ip-shared', feature: 'klp-extract', calls: 1, spent: 1 })
    for (const g of ['g2', 'g3', 'g4', 'g5'])
      seed({ guestId: g, ipHash: 'ip-shared', feature: 'klp-extract', admitted: false })
    expect(await reserveCall(ctx('g1', 'ip-shared'), 'klp-extract', NOW)).toMatchObject({ ok: true })
  })

  it('a later over-limit guest never displaces an earlier one', async () => {
    for (const [i, g] of ['g1', 'g2', 'g3'].entries()) {
      expect(await reserveCall(ctx(g, 'ip-shared'), 'klp-extract', at(i))).toMatchObject({ ok: true })
    }
    expect(await reserveCall(ctx('g4', 'ip-shared'), 'klp-extract', at(10))).toEqual(QUOTA)
    expect(await reserveCall(ctx('g1', 'ip-shared'), 'klp-extract', at(20))).toMatchObject({ ok: true })
  })

  it("doesn't count yesterday's tickets", async () => {
    for (const g of ['old1', 'old2', 'old3'])
      seed({ guestId: g, ipHash: 'ip-shared', feature: 'grade', calls: 1, spent: 1, createdAt: YESTERDAY })
    expect(await reserveCall(ctx('g1', 'ip-shared'), 'grade', NOW)).toMatchObject({ ok: true })
  })

  it('counts per feature', async () => {
    for (const g of ['g1', 'g2', 'g3']) seed({ guestId: g, ipHash: 'ip-shared', feature: 'grade', calls: 1, spent: 1 })
    expect(await reserveCall(ctx('g4', 'ip-shared'), 'klp-extract', NOW)).toMatchObject({ ok: true })
  })

  it('applies to startRun', async () => {
    for (const g of ['g1', 'g2', 'g3'])
      expect(await startRun(ctx(g, 'ip-shared'), 'hot-seat', NOW)).toEqual({ ok: true })
    expect(await startRun(ctx('g4', 'ip-shared'), 'hot-seat', NOW)).toEqual(QUOTA)
    expect(ticketOf('g4', 'hot-seat')).toBeUndefined()
  })

  it('a concurrent burst of four run starts on one IP opens at most three runs', async () => {
    const results = await Promise.all(
      ['g1', 'g2', 'g3', 'g4'].map((g) => startRun(ctx(g, 'ip-shared'), 'hot-seat', NOW)),
    )
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(3)
    expect(table.length).toBeLessThanOrEqual(3)
  })
})

describe('global daily cap', () => {
  it('refuses every feature once the day has spent the cap', async () => {
    seed({ guestId: 'x', feature: 'klp-extract', calls: 2, spent: 2 })
    const c = ctx('fresh', 'ip-fresh', { dailyCap: 2 })
    for (const f of ['grade', 'klp-extract', 'autocomplete', 'gauntlet', 'hot-seat'] as const) {
      expect(await reserveCall(c, f, NOW)).toEqual(CAP)
    }
  })

  it('sums spent, not calls: refunded calls still count', async () => {
    const c = ctx('g', 'ip', { dailyCap: 3 })
    for (let i = 0; i < 3; i++) {
      const r = await reserveCall(c, 'grade', NOW)
      if (!r.ok) throw new Error(`attempt ${i + 1} expected ok`)
      await releaseCall(r.ticketId, 'grade') // the provider failed
    }
    expect(await reserveCall(c, 'grade', NOW)).toEqual(CAP)
  })

  it("doesn't count yesterday's calls", async () => {
    seed({ guestId: 'x', feature: 'klp-extract', calls: 5, spent: 5, createdAt: YESTERDAY })
    expect(await reserveCall(ctx('fresh', 'ip-fresh', { dailyCap: 2 }), 'grade', NOW)).toMatchObject({ ok: true })
  })

  it('reports demo_cap ahead of a used ticket', async () => {
    const c = ctx('g', 'ip', { dailyCap: 2 })
    expect(await reserveCall(c, 'grade', NOW)).toMatchObject({ ok: true })
    seed({ guestId: 'x', feature: 'klp-extract', calls: 1, spent: 1 })
    expect(await reserveCall(c, 'grade', NOW)).toEqual(CAP)
  })

  it('a concurrent burst never spends past the cap', async () => {
    const results = await Promise.all(
      ['g1', 'g2', 'g3'].map((g) => reserveCall(ctx(g, `ip-${g}`, { dailyCap: 2 }), 'grade', NOW)),
    )
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(2)
    expect(results.filter((r) => !r.ok).every((r) => r.refusal === 'demo_cap')).toBe(true)
    // A refused reservation is handed back in full, so it neither holds a call nor bills one.
    const ok = results.filter((r) => r.ok).length
    expect(table.reduce((s, r) => s + r.spent, 0)).toBe(ok)
    expect(table.reduce((s, r) => s + r.calls, 0)).toBe(ok)
  })

  it('after a burst, sequential callers fill the cap exactly', async () => {
    await Promise.all(['g1', 'g2', 'g3'].map((g) => reserveCall(ctx(g, `ip-${g}`, { dailyCap: 2 }), 'grade', NOW)))
    const later = []
    for (const g of ['h1', 'h2', 'h3']) later.push(await reserveCall(ctx(g, `ip-${g}`, { dailyCap: 2 }), 'grade', NOW))
    expect(table.reduce((s, r) => s + r.spent, 0)).toBe(2)
    expect(later.at(-1)).toEqual(CAP)
  })
})
