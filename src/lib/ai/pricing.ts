/**
 * What an AI call costs, in US dollars per million tokens.
 *
 * THE RATES ARE DATA, NOT KNOWLEDGE. Nothing here is inferred, remembered or
 * estimated: every entry is a number somebody read off the provider's pricing
 * page and dated. A model with no entry costs `null` — displayed as "—" — and
 * that is the correct answer, for exactly the reason `CardKlp.model` is nullable
 * for legacy rows. A plausible-looking wrong price is worse than a blank,
 * because a spend cap built on it would silently let real money through.
 *
 * WHY IT IS EMPTY. Prices change, and a rate invented at the time this file was
 * written would be indistinguishable from one that was checked. Fill it in from
 * the provider's page, set `checkedOn`, and the admin panel starts showing cost
 * immediately — no other change needed.
 *
 * WHAT TO WATCH WHEN YOU FILL IT IN:
 *
 *  - Output is billed several times higher than input on every provider here,
 *    and this app's calls run roughly 800 input to 2,000+ output. Output is
 *    where the money is; the input rate barely matters.
 *  - `reasoningTokens` are billed as OUTPUT and are normally the majority of
 *    it — a measured grading call spent 1,963 output tokens of which 1,589 were
 *    reasoning. They are already included in `outputTokens`, so do NOT add them
 *    again; the separate column exists to explain a bill, not to be summed.
 *  - `cachedInputPerMTok` is the discounted rate for a cache HIT. Measured at 0
 *    hits on every call so far — these prompts are below the minimum cacheable
 *    prefix — so it is the least urgent field to get right.
 */

export interface ModelRate {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number
  /** USD per 1,000,000 output tokens. Reasoning tokens bill at this rate. */
  outputPerMTok: number
  /** USD per 1,000,000 input tokens served from cache. Omit if unknown. */
  cachedInputPerMTok?: number
  /** ISO date the rate was read off the provider's pricing page. */
  checkedOn: string
}

/**
 * Keyed `<provider>:<model>` — the same pair `AiCallLog` stores, so a lookup
 * needs no normalisation and a typo shows up as a missing price rather than as
 * the wrong one.
 */
export const MODEL_RATES: Record<string, ModelRate> = {
  // Example of the shape. Delete or replace — it is deliberately NOT a real
  // rate, and `estimateCallCost` returns null for it as for anything unlisted.
  //
  // 'google:gemini-3.6-flash': {
  //   inputPerMTok: 0,
  //   outputPerMTok: 0,
  //   checkedOn: '2026-09-06',
  // },
}

export interface CallUsage {
  provider: string
  model: string
  inputTokens: number | null
  outputTokens: number | null
  cachedTokens: number | null
}

/**
 * The dollar cost of one attempt, or `null` when the rate is unknown.
 *
 * `null` propagates rather than defaulting to 0: a total that quietly treats
 * unpriced calls as free is the failure this whole module exists to avoid.
 * Callers show "—" and say how many calls were unpriced.
 *
 * Cached input is billed at its own lower rate and is a SUBSET of
 * `inputTokens`, so it is subtracted before the full rate is applied rather
 * than added on top.
 */
export function estimateCallCost(usage: CallUsage): number | null {
  const rate = MODEL_RATES[`${usage.provider}:${usage.model}`]
  if (!rate) return null
  if (usage.inputTokens === null && usage.outputTokens === null) return null

  const cached = usage.cachedTokens ?? 0
  const uncachedInput = Math.max(0, (usage.inputTokens ?? 0) - cached)
  const cachedRate = rate.cachedInputPerMTok ?? rate.inputPerMTok

  return (
    (uncachedInput * rate.inputPerMTok) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    ((usage.outputTokens ?? 0) * rate.outputPerMTok) / 1_000_000
  )
}

export interface CostTotal {
  /** Dollars across every call that HAD a rate. */
  usd: number
  /** Calls that were priced. */
  priced: number
  /**
   * Calls with no rate for their model. A total is only honest read beside
   * this number — `$0.00 (12 unpriced)` means nothing is known, not that
   * nothing was spent.
   */
  unpriced: number
}

/** Sums what can be priced and counts what cannot, without conflating them. */
export function totalCost(usages: CallUsage[]): CostTotal {
  let usd = 0
  let priced = 0
  let unpriced = 0
  for (const usage of usages) {
    const cost = estimateCallCost(usage)
    if (cost === null) unpriced++
    else {
      usd += cost
      priced++
    }
  }
  return { usd, priced, unpriced }
}

/** `true` when at least one model has a rate, so the UI can hide a dead column. */
export function hasAnyRates(): boolean {
  return Object.keys(MODEL_RATES).length > 0
}
