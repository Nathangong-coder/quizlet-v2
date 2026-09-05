/**
 * Rate-limit pacing and retry-honoring for `scripts/author-klps.ts`'s
 * `--direct` path only (a raw `GOOGLE_API_KEY`, bypassing the `AiCredential`
 * pool's own rotation/failover in `src/lib/ai/generate.ts`).
 *
 * A 10-card pilot against a free-tier key failed on EVERY card with a
 * per-minute quota error, because the script fired 6-16 sequential calls per
 * card with no pacing and no regard for the provider's own `retryDelay`
 * hint. This module adds both: a proactive minimum spacing between calls
 * (`Pacer`), and a reactive retry that honors the hint when a call is
 * throttled anyway (`callWithPacingAndRetry`).
 *
 * Everything here is pure and clock-injected (`Clock`) so it is unit
 * testable with zero real waiting and zero network access — same posture as
 * `src/lib/klp/authoring.ts`'s injected `AuthoringGenerator`.
 */
import { classifyProviderError } from '@/lib/errors/classify'

/**
 * Proactive pacing ceiling for `--direct` runs. The pilot's free-tier key
 * hit `generativelanguage.googleapis.com/generate_content_free_tier_requests,
 * limit: 20` per minute; 12 req/min leaves headroom for the retries this
 * module itself issues, rather than pacing right up against the wall.
 * Override with `--rpm <n>` for a paid tier or a differently measured limit.
 */
export const DEFAULT_RPM = 12

/**
 * A retry hint above this is not a per-minute throttle clearing shortly — it
 * reads as the account being out of budget for the day. Sleeping a foreground
 * script for that long would look identical to a hang, so the run stops
 * cleanly instead.
 *
 * DEMOTED TO A FALLBACK on 2026-09-04. This threshold was originally the ONLY
 * daily-vs-per-minute discriminator, on the belief that Google words the two
 * identically and only the delay magnitude separates them. **A live 429 proved
 * that wrong in the worst direction**: a genuine
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` block (limit 20) came
 * back with a retry hint of THIRTY-FOUR SECONDS, well under this threshold, so
 * the run honored it and retried a cap that resets tomorrow — eight attempts,
 * about seven minutes, ending in a misleading "rate limit did not clear"
 * instead of "you are out of daily quota for this model". `parseQuotaViolation`
 * now reads the period off the structured payload, which states it outright;
 * this constant only decides cases where no structured violation is present.
 */
export const DAILY_QUOTA_THRESHOLD_MS = 5 * 60 * 1000

/** Retries a single rate-limited call this many times before giving up and
 *  halting the run — a safety net against a pathological repeat, not the
 *  normal path (a real per-minute throttle should clear in one or two). */
const DEFAULT_MAX_ATTEMPTS = 8

/** Small randomization added on top of every honored/backoff delay so a
 *  multi-process run (or a future concurrent one) doesn't retry in lockstep. */
const DEFAULT_JITTER_MS = 500

const BASE_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 60_000

/** Injected time source, exactly so tests never wait for real time. */
export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export function rpmToIntervalMs(rpm: number): number {
  return Math.ceil(60_000 / rpm)
}

/**
 * Enforces a minimum spacing between successive calls that share ONE
 * instance. The pilot's failure was inside a single card (6-16 calls back to
 * back), not just between cards — so `scripts/author-klps.ts` must construct
 * ONE `Pacer` per `--direct` run and route every `author`/`grade`/`revise`/
 * `relate` call through it, not one per card.
 */
export class Pacer {
  private nextAllowedAt = 0

  constructor(
    private readonly minIntervalMs: number,
    private readonly clock: Clock,
    private readonly onWait?: (waitMs: number) => void,
  ) {}

  async waitTurn(): Promise<void> {
    const now = this.clock.now()
    const waitMs = this.nextAllowedAt - now
    if (waitMs > 0) {
      this.onWait?.(waitMs)
      await this.clock.sleep(waitMs)
    }
    this.nextAllowedAt = this.clock.now() + this.minIntervalMs
  }
}

/**
 * Thrown to stop the WHOLE run cleanly (never just the current card) when
 * continuing would either sleep for hours or spin uselessly. `main()` in
 * `scripts/author-klps.ts` catches this specifically, prints how many cards
 * completed, and exits — the card the run was on is untouched (never marked
 * `klpStatus: 'failed'`), so the next invocation of the same command retries
 * it rather than skipping it, exactly like a daily-quota stop should.
 */
export class RunHaltedError extends Error {
  constructor(
    message: string,
    public readonly haltReason: 'daily_quota' | 'retries_exhausted',
    public readonly original: unknown,
  ) {
    super(message)
    this.name = 'RunHaltedError'
  }
}

function collectErrorText(err: unknown): string {
  const parts: string[] = []
  if (typeof err === 'string') parts.push(err)
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>
    if (typeof rec.message === 'string') parts.push(rec.message)
    if (typeof rec.responseBody === 'string') parts.push(rec.responseBody)
    if (rec.data !== undefined) {
      try {
        parts.push(JSON.stringify(rec.data))
      } catch {
        // Not JSON-serializable (e.g. a circular structure) — skip it, the
        // message/responseBody sources usually carry the hint anyway.
      }
    }
    const headers = rec.responseHeaders
    if (headers && typeof headers === 'object') {
      const retryAfter = (headers as Record<string, unknown>)['retry-after']
      if (typeof retryAfter === 'string') parts.push(`retry-after:${retryAfter}`)
    }
  }
  return parts.join(' ')
}

/**
 * Defensively extracts a retry delay from a provider error. Tried against
 * every shape actually seen or plausible for Google's generativelanguage
 * API, in order:
 *
 *   1. `google.rpc.RetryInfo`'s `retryDelay` field surviving in raw JSON
 *      (`"retryDelay":"13.808628001s"`) — present in `responseBody`/`data`
 *      when the SDK preserves the full error payload.
 *   2. The prose form Google's own error MESSAGE spells out
 *      ("Please retry in 13.808628001s.") — this is what the pilot's error
 *      text actually showed, so it is tried even though it's just as
 *      reasonably reached via `message` as via a structured field.
 *   3. A bare `Retry-After` HTTP header value, in case a future provider
 *      surfaces one there instead.
 *
 * Returns `undefined`, never throws, when nothing matches — callers fall
 * back to exponential backoff per REQUIREMENT 1.
 */
export function parseRetryDelayMs(err: unknown): number | undefined {
  const blob = collectErrorText(err)
  if (!blob) return undefined

  const retryInfoMatch = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(blob)
  if (retryInfoMatch) return Math.ceil(Number.parseFloat(retryInfoMatch[1]) * 1000)

  const proseMatch = /retry(?:ing)?\s*(?:in|after)\s*(\d+(?:\.\d+)?)\s*s\b/i.exec(blob)
  if (proseMatch) return Math.ceil(Number.parseFloat(proseMatch[1]) * 1000)

  const headerMatch = /retry-after:\s*(\d+(?:\.\d+)?)/i.exec(blob)
  if (headerMatch) return Math.ceil(Number.parseFloat(headerMatch[1]) * 1000)

  return undefined
}

/**
 * What a provider's 429 says about WHICH quota was hit, read off the structured
 * payload rather than inferred from the retry delay.
 *
 * Google returns a `google.rpc.QuotaFailure` detail whose `quotaId` names the
 * period outright — `GenerateRequestsPerDayPerProjectPerModel-FreeTier` versus
 * the `...PerMinute...` variants. That is decisive evidence, and it is the
 * evidence the original delay-magnitude heuristic did not know existed: a real
 * daily cap arrived with a 34-second hint, so magnitude alone classified it as
 * a per-minute throttle and the run retried a limit that resets tomorrow.
 *
 * Regex over the collected error text rather than `JSON.parse`, because
 * `collectErrorText` deliberately concatenates several shapes (message,
 * `responseBody`, `data`) and the result is not reliably a single JSON
 * document. `quotaValue` and the model dimension are read from AFTER the
 * matched id so a response carrying several violations attributes the limit to
 * the right one.
 *
 * A DAILY violation wins over a per-minute one when both are present: the daily
 * cap is the binding constraint, and waiting out the minute would just walk
 * back into it.
 */
export interface QuotaViolation {
  period: 'day' | 'minute'
  quotaId: string
  /** The limit as the provider stated it, when it stated one. */
  limit?: string
  /** The model the quota is scoped to, when the violation names one. */
  model?: string
}

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

export function exponentialBackoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
}

export interface RetryOptions {
  pacer: Pacer
  clock: Clock
  maxAttempts?: number
  jitterMs?: number
  /** Called before each honored/backoff sleep, so a slow run prints progress
   *  instead of looking hung. */
  onRetryWait?: (info: { attempt: number; waitMs: number; kind: 'rate_limited' | 'quota_exhausted' }) => void
}

/**
 * Runs `fn`, pacing every attempt through `pacer` and retrying a
 * rate-limit/quota error by honoring the provider's own hint (falling back
 * to exponential backoff when none is found).
 *
 * A NON-rate-limit error (anything `classifyProviderError` maps to a kind
 * other than `rate_limited`/`quota_exhausted`) is rethrown immediately on
 * the first attempt — `authorCard`'s caller still treats that as a real card
 * failure, unchanged from before this module existed (REQUIREMENT 3).
 *
 * Daily-vs-per-minute (REQUIREMENT 4) is NOT decided by
 * `classifyProviderError`'s kind alone. Google's own free-tier per-minute
 * throttle message literally contains the phrase "exceeded your current
 * quota" — the exact wording `classifyProviderError`'s `quotaWording()`
 * heuristic keys off to return `quota_exhausted`, indistinguishable BY WORDING
 * ALONE from a real daily cap.
 *
 * THE STRUCTURED VIOLATION DECIDES IT, and the retry hint is only a fallback.
 * That order was reversed until a live 429 on 2026-09-04 disproved the
 * assumption behind it: a genuine daily cap
 * (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 20) arrived with
 * a THIRTY-FOUR SECOND retry hint. Magnitude alone therefore classified a
 * limit that resets tomorrow as a throttle clearing shortly, and the run slept
 * and retried it eight times — roughly seven minutes — before halting with the
 * wrong reason. `parseQuotaViolation` reads the period straight off the
 * payload, where Google states it outright. The decision is now:
 *
 *   - The payload names a PER-DAY quota: halt immediately via `RunHaltedError`,
 *     naming the model and the limit. No amount of waiting clears it today, and
 *     honoring its short hint is the exact mistake described above.
 *   - The payload names a PER-MINUTE quota: retry, and do NOT halt for a
 *     missing hint — the provider has positively said this is the short kind.
 *   - No structured violation, and a hinted delay <= `DAILY_QUOTA_THRESHOLD_MS`:
 *     honor it and retry, REGARDLESS of which kind `classifyProviderError` chose.
 *   - No structured violation, and either an implausibly long hint or no hint
 *     at all with kind `quota_exhausted` (no recovery time AND quota wording —
 *     the one case with no evidence this clears soon): halt the run.
 *   - No structured violation, no hint, kind plain `rate_limited` (no quota
 *     wording): exponential backoff and retry, since nothing suggests a daily
 *     block.
 */
export async function callWithPacingAndRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const jitterMs = opts.jitterMs ?? DEFAULT_JITTER_MS

  for (let attempt = 0; ; attempt++) {
    await opts.pacer.waitTurn()

    try {
      return await fn()
    } catch (err) {
      const kind = classifyProviderError(err)
      if (kind !== 'rate_limited' && kind !== 'quota_exhausted') throw err

      const hinted = parseRetryDelayMs(err)
      const violation = parseQuotaViolation(err)

      // The provider said outright that this is the daily bucket. Its retry
      // hint is worthless here — a real one read 34s for a limit that resets
      // tomorrow — so it is deliberately not consulted.
      if (violation?.period === 'day') {
        const scope = violation.model ? ` for model ${violation.model}` : ''
        const limit = violation.limit ? ` (limit ${violation.limit})` : ''
        throw new RunHaltedError(
          `Daily AI quota exhausted${scope}${limit}: ${violation.quotaId}. This does not clear by waiting — ` +
            'the run is resumable, so re-run the same command tomorrow, point KLP_DIRECT_MODEL at a model ' +
            "with its own unused daily bucket, or raise the key's quota tier.",
          'daily_quota',
          err,
        )
      }

      const isImplausiblyLong = hinted !== undefined && hinted > DAILY_QUOTA_THRESHOLD_MS
      // A named per-minute violation is positive evidence this is the short
      // kind, so a missing retry hint is no longer grounds to halt.
      const isUnexplainedQuotaClaim =
        hinted === undefined && kind === 'quota_exhausted' && violation?.period !== 'minute'

      if (isImplausiblyLong || isUnexplainedQuotaClaim) {
        throw new RunHaltedError(
          `Daily AI quota appears exhausted (${kind}${
            hinted !== undefined ? `, hinted retry ${Math.round(hinted / 1000)}s` : ', no retry hint given'
          }). Stopping the run — it is resumable; re-run the same command later to pick up where it left off.`,
          'daily_quota',
          err,
        )
      }

      if (attempt + 1 >= maxAttempts) {
        throw new RunHaltedError(
          `Rate limit did not clear after ${maxAttempts} retries. Stopping the run rather than looping forever — ` +
            'it is resumable; re-run the same command later to pick up where it left off.',
          'retries_exhausted',
          err,
        )
      }

      const baseDelay = hinted ?? exponentialBackoffMs(attempt)
      const waitMs = baseDelay + Math.floor(Math.random() * jitterMs)
      opts.onRetryWait?.({ attempt: attempt + 1, waitMs, kind: kind as 'rate_limited' | 'quota_exhausted' })
      await opts.clock.sleep(waitMs)
    }
  }
}
