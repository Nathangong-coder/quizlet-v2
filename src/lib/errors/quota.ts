/**
 * Reading a provider's 429 for WHICH quota it was, from the structured payload
 * rather than from wording or from the size of the retry hint.
 *
 * This lives beside `classify.ts` rather than inside the KLP authoring script
 * because both need it and for the same reason. Google words a per-MINUTE
 * throttle and a per-DAY cap identically — both say "You exceeded your current
 * quota" — but they need opposite handling:
 *
 *   - per minute: transient, clears by itself, must NOT badge the key
 *   - per day:    needs the user to act, must badge the key
 *
 * `classifyProviderError` had only the wording, so it called both
 * `quota_exhausted`, which is non-retryable and therefore flagworthy — meaning
 * every brief 429 marked a perfectly healthy credential as broken in settings.
 * The response says which one it is; nothing had been reading it.
 */

/** Which bucket the provider says was exhausted. */
export type QuotaPeriod = 'day' | 'minute'

export interface QuotaViolation {
  period: QuotaPeriod
  quotaId: string
  /** The limit as the provider stated it, when it stated one. */
  limit?: string
  /** The model the quota is scoped to, when the violation names one. */
  model?: string
}

/**
 * Flattens an error into searchable text, WALKING THE NESTED ERROR CHAIN.
 *
 * The nesting is the actual shape, not defensive programming. What a caller
 * catches from the AI SDK is an `AI_RetryError`, whose own enumerable keys are
 * `name, cause, reason, errors, lastError`; the `APICallError` carrying
 * `responseBody` — and with it the only statement of which quota was hit — is a
 * level down. A top-level-only reader finds the message and nothing else, which
 * is enough for wording checks and useless for structured ones.
 *
 * Depth-capped and visited-guarded, because `cause` chains can loop.
 */
export function collectErrorText(err: unknown, depth = 0, seen = new Set<unknown>()): string {
  if (depth > 4 || (err !== null && typeof err === 'object' && seen.has(err))) return ''
  if (typeof err === 'string') return err
  if (!err || typeof err !== 'object') return ''
  seen.add(err)

  const parts: string[] = []
  const rec = err as Record<string, unknown>
  if (typeof rec.message === 'string') parts.push(rec.message)
  if (typeof rec.responseBody === 'string') parts.push(rec.responseBody)
  if (rec.data !== undefined) {
    try {
      parts.push(JSON.stringify(rec.data))
    } catch {
      // Not JSON-serializable (e.g. a circular structure) — skip it; the
      // message/responseBody sources usually carry what is needed anyway.
    }
  }
  const headers = rec.responseHeaders
  if (headers && typeof headers === 'object') {
    const retryAfter = (headers as Record<string, unknown>)['retry-after']
    if (typeof retryAfter === 'string') parts.push(`retry-after:${retryAfter}`)
  }

  // `lastError` and `errors` are AI_RetryError's own fields; `cause` is the
  // standard chain. All three are followed so the body is reachable however the
  // SDK happens to wrap it.
  for (const nested of [rec.lastError, rec.cause]) {
    if (nested !== undefined) parts.push(collectErrorText(nested, depth + 1, seen))
  }
  if (Array.isArray(rec.errors)) {
    for (const nested of rec.errors) parts.push(collectErrorText(nested, depth + 1, seen))
  }

  return parts.filter(Boolean).join(' ')
}

/**
 * The quota a 429 names, or undefined when it names none.
 *
 * Google returns a `google.rpc.QuotaFailure` detail whose `quotaId` states the
 * period outright — `GenerateRequestsPerDayPerProjectPerModel-FreeTier` versus
 * the `...PerMinute...` variants. Measured live 2026-09-04: the per-day cap
 * arrives with a retry hint of **34 seconds**, so any heuristic reading the
 * hint's magnitude classifies a limit that resets tomorrow as one clearing
 * shortly.
 *
 * Regex over the collected text rather than `JSON.parse`, because
 * `collectErrorText` concatenates several shapes and the result is not reliably
 * one JSON document. `quotaValue` and the model dimension are read from AFTER
 * the matched id, so a response carrying several violations attributes the
 * limit to the right one.
 *
 * A DAILY violation wins over a per-minute one when both are present: the daily
 * cap is the binding constraint, and waiting out the minute walks back into it.
 */
export function parseQuotaViolation(err: unknown): QuotaViolation | undefined {
  const blob = collectErrorText(err)
  if (!blob) return undefined

  const ids = [...blob.matchAll(/"quotaId"\s*:\s*"([^"]+)"/gi)]
  if (ids.length === 0) return undefined

  const daily = ids.find((m) => /perday/i.test(m[1]))
  const minute = ids.find((m) => /perminute/i.test(m[1]))
  const chosen = daily ?? minute
  if (!chosen) return undefined

  const after = blob.slice((chosen.index ?? 0) + chosen[0].length)
  const limit = /"quotaValue"\s*:\s*"?(\d+)"?/i.exec(after)?.[1]
  const model = /"model"\s*:\s*"([^"]+)"/i.exec(after)?.[1]

  return {
    period: daily ? 'day' : 'minute',
    quotaId: chosen[1],
    ...(limit !== undefined ? { limit } : {}),
    ...(model !== undefined ? { model } : {}),
  }
}
