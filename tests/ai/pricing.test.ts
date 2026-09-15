import { describe, it, expect } from 'vitest'
import { estimateCallCost, totalCost, MODEL_RATES, type CallUsage } from '@/lib/ai/pricing'

const usage = (over: Partial<CallUsage> = {}): CallUsage => ({
  provider: 'google', model: 'test-model',
  inputTokens: 1000, outputTokens: 2000, cachedTokens: 0, ...over,
})

describe('estimateCallCost', () => {
  it('returns null for a model with no rate, never 0', () => {
    // A 0 is a claim that the call was free. A spend cap built on that would
    // let real money through silently — the exact failure this module exists
    // to avoid.
    expect(estimateCallCost(usage())).toBeNull()
  })

  it('prices input and output at their own rates', () => {
    MODEL_RATES['google:priced'] = { inputPerMTok: 10, outputPerMTok: 100, checkedOn: '2026-09-06' }
    // 1,000 in @ $10/M = $0.01; 2,000 out @ $100/M = $0.20
    expect(estimateCallCost(usage({ model: 'priced' }))).toBeCloseTo(0.21, 10)
    delete MODEL_RATES['google:priced']
  })

  it('treats cached input as a SUBSET of input, not an addition', () => {
    // Double-counting cached tokens would overstate a bill on exactly the
    // calls a cache was meant to make cheaper.
    MODEL_RATES['google:cached'] = {
      inputPerMTok: 100, outputPerMTok: 0, cachedInputPerMTok: 10, checkedOn: '2026-09-06',
    }
    // 1,000 input of which 400 cached => 600 @ $100/M + 400 @ $10/M
    const cost = estimateCallCost(usage({ model: 'cached', outputTokens: 0, cachedTokens: 400 }))
    expect(cost).toBeCloseTo(0.06 + 0.004, 10)
    delete MODEL_RATES['google:cached']
  })

  it('returns null when the provider reported no usage at all', () => {
    MODEL_RATES['google:nousage'] = { inputPerMTok: 10, outputPerMTok: 100, checkedOn: '2026-09-06' }
    expect(estimateCallCost(usage({ model: 'nousage', inputTokens: null, outputTokens: null }))).toBeNull()
    delete MODEL_RATES['google:nousage']
  })
})

describe('totalCost', () => {
  it('counts unpriced calls separately instead of scoring them as free', () => {
    MODEL_RATES['google:known'] = { inputPerMTok: 0, outputPerMTok: 1000, checkedOn: '2026-09-06' }
    const total = totalCost([
      usage({ model: 'known', inputTokens: 0, outputTokens: 1_000_000 }),
      usage({ model: 'unknown' }),
      usage({ model: 'unknown' }),
    ])
    expect(total.usd).toBeCloseTo(1000, 6)
    expect(total.priced).toBe(1)
    // "$1000.00 (2 unpriced)" is honest; "$1000.00" alone is not.
    expect(total.unpriced).toBe(2)
    delete MODEL_RATES['google:known']
  })

  it('reports zero spend and zero priced calls for an empty list', () => {
    expect(totalCost([])).toEqual({ usd: 0, priced: 0, unpriced: 0 })
  })
})

describe('the rate table', () => {
  it('prices GLM on the zai provider, and on a custom endpoint carrying a glm model id', () => {
    const zai = estimateCallCost({ provider: 'zai', model: 'glm-5.3-flash', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 0 })
    expect(zai).toBeCloseTo(0.15 + 0.5)
    expect(estimateCallCost({ provider: 'custom', model: 'glm-5.3-flash', inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 })).toBeCloseTo(0.15)
    // Any other custom model is still unpriced: the endpoint could be anything.
    expect(estimateCallCost({ provider: 'custom', model: 'mystery-9b', inputTokens: 10, outputTokens: 10, cachedTokens: 0 })).toBeNull()
  })

  it('agrees with the operator token meter on every model both tables price', async () => {
    const meter = await import('@/lib/klp/token-meter')
    for (const [id, m] of Object.entries(meter.MODEL_RATES)) {
      if (!id.startsWith('glm-')) continue
      const r = MODEL_RATES[`zai:${id}`]
      expect(r, id).toBeDefined()
      expect([r.inputPerMTok, r.outputPerMTok, r.cachedInputPerMTok]).toEqual([m.input, m.output, m.cachedInput])
    }
  })

  it('carries a checked date on every entry it does have', () => {
    // A rate with no date cannot be audited, and prices change.
    for (const [key, rate] of Object.entries(MODEL_RATES)) {
      expect(rate.checkedOn, key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
