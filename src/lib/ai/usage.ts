import type { PrismaClient } from '@prisma/client'
import { estimateCallCost, type CostTotal } from '@/lib/ai/pricing'

/**
 * How much AI one learner has actually used, read straight from `AiCallLog`.
 *
 * There is no separate counter and there will not be one. The log already
 * records userId, model, task, outcome and tokens per attempt, so any summary
 * is a fold over rows that must exist anyway. A cached total would be a second
 * source of truth that can drift, and the first thing anyone would ask of a
 * drifting total is to recompute it from the log.
 */

/** Rolling window for the learner-facing tracker. */
export const USAGE_WINDOW_DAYS = 30

export interface UsageBucket {
  /** A model id, or a task name — whichever this breakdown groups by. */
  key: string
  calls: number
  inputTokens: number
  outputTokens: number
  cost: CostTotal
}

export interface UsageSummary {
  windowDays: number
  calls: number
  failures: number
  inputTokens: number
  outputTokens: number
  /**
   * Reported SEPARATELY, and already inside `outputTokens` — the provider
   * bills reasoning as output. Adding it again would overstate every total by
   * however much the model thought.
   */
  reasoningTokens: number
  cachedTokens: number
  cost: CostTotal
  byModel: UsageBucket[]
  byTask: UsageBucket[]
}

export interface UsageRow {
  task: string
  model: string
  provider: string
  ok: boolean
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cachedTokens: number | null
}

/**
 * Fold raw log rows into a summary. Pure, so the arithmetic is testable with
 * no database.
 *
 * Cost follows `totalCost`'s existing convention rather than a second one:
 * priced calls are summed, unpriced calls are COUNTED, and the two are never
 * merged. `$0.00` beside `12 unpriced` says "unknown"; a bare `$0.00` would
 * say "free", and Google — the provider serving most calls here — has no rate
 * table at all.
 *
 * FAILED calls are included in the token totals. A call that rambled to its
 * output ceiling and returned nothing still consumed everything it generated,
 * and that is exactly the usage a tracker exists to make visible.
 */
export function summarizeUsage(rows: UsageRow[], windowDays = USAGE_WINDOW_DAYS): UsageSummary {
  const summary: UsageSummary = {
    windowDays,
    calls: rows.length,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cost: { usd: 0, priced: 0, unpriced: 0 },
    byModel: [],
    byTask: [],
  }

  const models = new Map<string, UsageBucket>()
  const tasks = new Map<string, UsageBucket>()

  const bucketFor = (map: Map<string, UsageBucket>, key: string): UsageBucket => {
    let bucket = map.get(key)
    if (!bucket) {
      bucket = {
        key,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: { usd: 0, priced: 0, unpriced: 0 },
      }
      map.set(key, bucket)
    }
    return bucket
  }

  const addCost = (total: CostTotal, cost: number | null) => {
    if (cost === null) total.unpriced += 1
    else {
      total.usd += cost
      total.priced += 1
    }
  }

  for (const row of rows) {
    const input = row.inputTokens ?? 0
    const output = row.outputTokens ?? 0
    const cost = estimateCallCost({
      provider: row.provider,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedTokens: row.cachedTokens,
    })

    if (!row.ok) summary.failures += 1
    summary.inputTokens += input
    summary.outputTokens += output
    summary.reasoningTokens += row.reasoningTokens ?? 0
    summary.cachedTokens += row.cachedTokens ?? 0
    addCost(summary.cost, cost)

    for (const [map, key] of [
      [models, row.model],
      [tasks, row.task],
    ] as const) {
      const bucket = bucketFor(map, key)
      bucket.calls += 1
      bucket.inputTokens += input
      bucket.outputTokens += output
      addCost(bucket.cost, cost)
    }
  }

  const byTokens = (a: UsageBucket, b: UsageBucket) =>
    b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
  summary.byModel = [...models.values()].sort(byTokens)
  summary.byTask = [...tasks.values()].sort(byTokens)
  return summary
}

/** Load and summarize one user's calls over the trailing window. */
export async function loadUsageSummary(
  prisma: PrismaClient,
  userId: string,
  windowDays = USAGE_WINDOW_DAYS,
): Promise<UsageSummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  const rows = await prisma.aiCallLog.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      task: true,
      model: true,
      provider: true,
      ok: true,
      inputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      cachedTokens: true,
    },
  })
  return summarizeUsage(rows, windowDays)
}
