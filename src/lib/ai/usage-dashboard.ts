import type { PrismaClient } from '@prisma/client'
import { estimateCallCost, type CostTotal } from '@/lib/ai/pricing'
import { AI_TASK_LABELS, type AiTask } from '@/lib/ai/model-routing'

/**
 * The AI usage dashboard's data — a fold over `AiCallLog` rows, pure, so
 * every number on the page is testable without a database. Same conventions
 * as `usage.ts`: priced dollars are summed, unpriced calls are COUNTED and
 * never merged into the dollars; failed calls keep their tokens; reasoning is
 * reported separately and already inside `outputTokens`.
 *
 * Adds what the settings panel could not show (owner, 2026-09-14): a per-day
 * series stacked by model or task, each task's share for a pie, and the
 * call-by-call history with every call labelled.
 */

export const USAGE_WINDOWS = [7, 30, 90] as const
export type UsageWindow = (typeof USAGE_WINDOWS)[number]

export function parseWindow(raw: string | undefined): UsageWindow {
  const n = Number(raw)
  return (USAGE_WINDOWS as readonly number[]).includes(n) ? (n as UsageWindow) : 30
}

export interface DashboardRow {
  id: string
  createdAt: Date
  task: string
  model: string
  provider: string
  credentialLabel: string
  ok: boolean
  failureKind: string | null
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cachedTokens: number | null
}

export interface Bucket {
  key: string
  label: string
  calls: number
  failures: number
  inputTokens: number
  outputTokens: number
  tokens: number
  cost: CostTotal
  /** Share of all tokens in the window, 0..1. */
  share: number
}

export interface DayPoint {
  /** YYYY-MM-DD, UTC. */
  day: string
  calls: number
  tokens: number
  cost: number
  byModel: Record<string, { calls: number; tokens: number; cost: number }>
  byTask: Record<string, { calls: number; tokens: number; cost: number }>
}

export interface HistoryRow {
  id: string
  at: string
  task: string
  taskLabel: string
  model: string
  provider: string
  key: string
  ok: boolean
  failureKind: string | null
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cachedTokens: number | null
  /** Dollars, or null when the model has no rate. */
  cost: number | null
}

export interface UsageDashboard {
  windowDays: UsageWindow
  key: string | null
  keys: string[]
  totals: {
    calls: number
    failures: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cachedTokens: number
    tokens: number
    cost: CostTotal
    /** Mean latency of successful calls, ms; null when none. */
    latencyMs: number | null
  }
  byModel: Bucket[]
  byTask: Bucket[]
  days: DayPoint[]
  history: HistoryRow[]
}

export function taskLabel(task: string): string {
  return (AI_TASK_LABELS as Record<string, string>)[task as AiTask] ?? task
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Every day in the window, oldest first, so a quiet day is a zero and not a gap. */
export function windowDays(now: Date, days: number): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(new Date(now.getTime() - i * 86_400_000)))
  return out
}

export function shapeDashboard(input: { rows: DashboardRow[]; windowDays: UsageWindow; key: string | null; now: Date }): UsageDashboard {
  // The window is applied here too, not only in the query, so the page and a
  // test see the same rows for the same "now".
  const since = input.now.getTime() - input.windowDays * 86_400_000
  const inWindow = input.rows.filter((r) => r.createdAt.getTime() >= since)
  const keys = [...new Set(inWindow.map((r) => r.credentialLabel))].sort()
  const rows = input.key ? inWindow.filter((r) => r.credentialLabel === input.key) : inWindow

  const totals: UsageDashboard['totals'] = {
    calls: rows.length,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    tokens: 0,
    cost: { usd: 0, priced: 0, unpriced: 0 },
    latencyMs: null,
  }
  const models = new Map<string, Bucket>()
  const tasks = new Map<string, Bucket>()
  const dayMap = new Map<string, DayPoint>()
  for (const day of windowDays(input.now, input.windowDays)) dayMap.set(day, { day, calls: 0, tokens: 0, cost: 0, byModel: {}, byTask: {} })

  const bucket = (map: Map<string, Bucket>, key: string, label: string): Bucket => {
    let b = map.get(key)
    if (!b) {
      b = { key, label, calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, tokens: 0, cost: { usd: 0, priced: 0, unpriced: 0 }, share: 0 }
      map.set(key, b)
    }
    return b
  }
  const addCost = (t: CostTotal, cost: number | null) => {
    if (cost === null) t.unpriced += 1
    else {
      t.usd += cost
      t.priced += 1
    }
  }

  let okLatency = 0
  let okCount = 0
  const history: HistoryRow[] = []

  for (const r of rows) {
    const input_ = r.inputTokens ?? 0
    const output = r.outputTokens ?? 0
    const tokens = input_ + output
    const cost = estimateCallCost({ provider: r.provider, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens })

    if (!r.ok) totals.failures += 1
    else {
      okLatency += r.latencyMs
      okCount += 1
    }
    totals.inputTokens += input_
    totals.outputTokens += output
    totals.reasoningTokens += r.reasoningTokens ?? 0
    totals.cachedTokens += r.cachedTokens ?? 0
    totals.tokens += tokens
    addCost(totals.cost, cost)

    for (const b of [bucket(models, r.model, r.model), bucket(tasks, r.task, taskLabel(r.task))]) {
      b.calls += 1
      if (!r.ok) b.failures += 1
      b.inputTokens += input_
      b.outputTokens += output
      b.tokens += tokens
      addCost(b.cost, cost)
    }

    const day = dayMap.get(dayKey(r.createdAt))
    if (day) {
      day.calls += 1
      day.tokens += tokens
      day.cost += cost ?? 0
      for (const [rec, key] of [
        [day.byModel, r.model],
        [day.byTask, r.task],
      ] as const) {
        const cur = rec[key] ?? { calls: 0, tokens: 0, cost: 0 }
        cur.calls += 1
        cur.tokens += tokens
        cur.cost += cost ?? 0
        rec[key] = cur
      }
    }

    history.push({
      id: r.id,
      at: r.createdAt.toISOString(),
      task: r.task,
      taskLabel: taskLabel(r.task),
      model: r.model,
      provider: r.provider,
      key: r.credentialLabel,
      ok: r.ok,
      failureKind: r.failureKind,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      reasoningTokens: r.reasoningTokens,
      cachedTokens: r.cachedTokens,
      cost,
    })
  }

  totals.latencyMs = okCount > 0 ? Math.round(okLatency / okCount) : null
  const share = (b: Bucket) => (totals.tokens > 0 ? b.tokens / totals.tokens : totals.calls > 0 ? b.calls / totals.calls : 0)
  const byTokens = (a: Bucket, b: Bucket) => b.tokens - a.tokens || b.calls - a.calls
  const byModel = [...models.values()].map((b) => ({ ...b, share: share(b) })).sort(byTokens)
  const byTask = [...tasks.values()].map((b) => ({ ...b, share: share(b) })).sort(byTokens)
  history.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return { windowDays: input.windowDays, key: input.key, keys, totals, byModel, byTask, days: [...dayMap.values()], history }
}

/** CSV of the history, for the Export button. Pure. */
export function historyCsv(rows: readonly HistoryRow[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['time', 'task', 'model', 'provider', 'key', 'ok', 'failure', 'latency_ms', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens', 'cost_usd']
  const lines = rows.map((r) => [r.at, r.taskLabel, r.model, r.provider, r.key, r.ok ? 'ok' : 'failed', r.failureKind, r.latencyMs, r.inputTokens, r.outputTokens, r.reasoningTokens, r.cachedTokens, r.cost === null ? '' : r.cost.toFixed(6)].map(esc).join(','))
  return [head.join(','), ...lines].join('\n')
}

export async function loadUsageDashboard(prisma: PrismaClient, userId: string, opts: { windowDays: UsageWindow; key: string | null; now?: Date }): Promise<UsageDashboard> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - opts.windowDays * 86_400_000)
  const rows = await prisma.aiCallLog.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      task: true,
      model: true,
      provider: true,
      credentialLabel: true,
      ok: true,
      failureKind: true,
      latencyMs: true,
      inputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      cachedTokens: true,
    },
  })
  return shapeDashboard({ rows, windowDays: opts.windowDays, key: opts.key, now })
}
