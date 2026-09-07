import { describe, it, expect } from 'vitest'
import { summarizeUsage, type UsageRow } from '@/lib/ai/usage'

function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    task: 'grade',
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
    ok: true,
    inputTokens: 1_000,
    outputTokens: 500,
    reasoningTokens: null,
    cachedTokens: null,
    ...over,
  }
}

describe('summarizeUsage', () => {
  it('counts reasoning tokens ONCE, inside the output figure', () => {
    // Providers bill thinking as output, and the SDK already includes it in
    // `outputTokens`. Adding it again is the single easiest way to hand a user
    // a total that overstates what they used.
    const usage = summarizeUsage([row({ outputTokens: 500, reasoningTokens: 300 })])
    expect(usage.outputTokens).toBe(500)
    expect(usage.reasoningTokens).toBe(300)
    expect(usage.inputTokens + usage.outputTokens).toBe(1_500)
  })

  it('includes failed calls in the token totals', () => {
    // A call that rambled to its output ceiling and returned nothing still
    // consumed everything it generated — exactly the usage a tracker exists
    // to make visible.
    const usage = summarizeUsage([row({ ok: false, outputTokens: 15_000 })])
    expect(usage.failures).toBe(1)
    expect(usage.outputTokens).toBe(15_000)
  })

  it('counts an unpriced model rather than pricing it at zero', () => {
    // Google publishes no rate table this app carries. A bare $0.00 would read
    // as "free"; the unpriced count is what makes it read as "unknown".
    const usage = summarizeUsage([row({ provider: 'google', model: 'gemini-3.6-flash' })])
    expect(usage.cost.priced).toBe(0)
    expect(usage.cost.unpriced).toBe(1)
    expect(usage.cost.usd).toBe(0)
  })

  it('keeps priced and unpriced calls apart in the same window', () => {
    const usage = summarizeUsage([
      row({ provider: 'google', model: 'gemini-3.6-flash' }),
      row(),
    ])
    expect(usage.cost.unpriced).toBe(1)
    expect(usage.cost.priced + usage.cost.unpriced).toBe(usage.calls)
  })

  it('breaks down by task and by model, heaviest first', () => {
    const usage = summarizeUsage([
      row({ task: 'grade', inputTokens: 100, outputTokens: 0 }),
      row({ task: 'diagnostic', model: 'gemini-3.6-flash', inputTokens: 5_000, outputTokens: 0 }),
      row({ task: 'diagnostic', model: 'gemini-3.6-flash', inputTokens: 1_000, outputTokens: 0 }),
    ])
    expect(usage.byTask.map((b) => b.key)).toEqual(['diagnostic', 'grade'])
    expect(usage.byTask[0]).toMatchObject({ calls: 2, inputTokens: 6_000 })
    expect(usage.byModel.map((b) => b.key)).toEqual(['gemini-3.6-flash', 'deepseek-v4-flash'])
  })

  it('summarizes an empty window without inventing a cost', () => {
    const usage = summarizeUsage([])
    expect(usage.calls).toBe(0)
    expect(usage.cost).toEqual({ usd: 0, priced: 0, unpriced: 0 })
    expect(usage.byTask).toEqual([])
  })
})
