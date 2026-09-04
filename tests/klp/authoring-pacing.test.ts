import { describe, it, expect, vi } from 'vitest'
import {
  Pacer,
  callWithPacingAndRetry,
  parseRetryDelayMs,
  rpmToIntervalMs,
  exponentialBackoffMs,
  RunHaltedError,
  DEFAULT_RPM,
  DAILY_QUOTA_THRESHOLD_MS,
  type Clock,
} from '@/lib/klp/authoring-pacing'

/** A clock with no real waiting: `sleep` just advances `now()` and records
 *  the requested duration, so tests assert on delays without ever waiting. */
function fakeClock(): Clock & { sleeps: number[] } {
  let current = 0
  const sleeps: number[] = []
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      current += ms
    },
    sleeps,
  }
}

function errorWithMessage(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), extra)
}

/** Shaped exactly like the pilot's reproduced failure: Google's free-tier
 *  per-minute throttle, wording that says "quota" but a short retry hint. */
function perMinuteThrottleError(retrySeconds: number): Error {
  return errorWithMessage(
    `You exceeded your current quota\n` +
      `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ` +
      `limit: 20, model: gemini-3.6-flash\n` +
      `Please retry in ${retrySeconds}s.`,
  )
}

describe('rpmToIntervalMs', () => {
  it('converts a requests-per-minute ceiling into a minimum interval', () => {
    expect(rpmToIntervalMs(60)).toBe(1000)
    expect(rpmToIntervalMs(12)).toBe(5000)
  })

  it('has a safe, documented default', () => {
    expect(DEFAULT_RPM).toBeGreaterThan(0)
    expect(DEFAULT_RPM).toBeLessThanOrEqual(20) // under the pilot's observed 20/min ceiling
  })
})

describe('parseRetryDelayMs', () => {
  it('parses the prose form Google actually returned in the pilot', () => {
    expect(parseRetryDelayMs(perMinuteThrottleError(13.808628001))).toBe(13809)
  })

  it('parses a structured google.rpc.RetryInfo retryDelay field', () => {
    const err = errorWithMessage('rate limited', {
      responseBody: '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"6.6s"}]}}',
    })
    expect(parseRetryDelayMs(err)).toBe(6600)
  })

  it('parses a bare Retry-After header', () => {
    const err = errorWithMessage('rate limited', { responseHeaders: { 'retry-after': '20' } })
    expect(parseRetryDelayMs(err)).toBe(20000)
  })

  it('returns undefined when nothing matches', () => {
    expect(parseRetryDelayMs(errorWithMessage('totally unrelated failure'))).toBeUndefined()
    expect(parseRetryDelayMs(null)).toBeUndefined()
  })
})

describe('exponentialBackoffMs', () => {
  it('grows with attempt number and is capped', () => {
    expect(exponentialBackoffMs(0)).toBe(2000)
    expect(exponentialBackoffMs(1)).toBe(4000)
    expect(exponentialBackoffMs(2)).toBe(8000)
    expect(exponentialBackoffMs(10)).toBe(60000) // capped
  })
})

describe('Pacer', () => {
  it('does not wait on the very first call', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(1000, clock)
    await pacer.waitTurn()
    expect(clock.sleeps).toEqual([])
  })

  it('enforces the minimum interval between consecutive calls', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(1000, clock)
    await pacer.waitTurn() // t=0, no wait
    await pacer.waitTurn() // t=0 still (fake clock doesn't move on its own) -> must wait ~1000ms
    expect(clock.sleeps).toEqual([1000])
  })

  it('does not double-charge when real time already passed between calls', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(1000, clock)
    await pacer.waitTurn()
    // Simulate 1200ms of real work happening between calls by sleeping via the clock directly.
    await clock.sleep(1200)
    await pacer.waitTurn()
    // Only the manual 1200ms sleep should be recorded — no additional pacing wait was needed.
    expect(clock.sleeps).toEqual([1200])
  })

  it('calls onWait with the delay before sleeping', async () => {
    const clock = fakeClock()
    const onWait = vi.fn()
    const pacer = new Pacer(1000, clock, onWait)
    await pacer.waitTurn()
    await pacer.waitTurn()
    expect(onWait).toHaveBeenCalledWith(1000)
  })
})

describe('callWithPacingAndRetry', () => {
  it('retries a rate-limited call after the hinted delay, then succeeds', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(0, clock)
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw perMinuteThrottleError(13.8)
      return 'ok'
    })

    const onRetryWait = vi.fn()
    const result = await callWithPacingAndRetry(fn, { pacer, clock, onRetryWait, jitterMs: 0 })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(clock.sleeps).toEqual([13800])
    expect(onRetryWait).toHaveBeenCalledWith({ attempt: 1, waitMs: 13800, kind: 'quota_exhausted' })
  })

  it('falls back to exponential backoff when no retry hint is found', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(0, clock)
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw errorWithMessage('429 Too Many Requests')
      return 'ok'
    })

    const result = await callWithPacingAndRetry(fn, { pacer, clock, jitterMs: 0 })
    expect(result).toBe('ok')
    expect(clock.sleeps).toEqual([2000]) // exponentialBackoffMs(0)
  })

  it('stops the run instead of sleeping when a retry delay is implausibly long', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(0, clock)
    const longDelaySeconds = (DAILY_QUOTA_THRESHOLD_MS / 1000) + 60 // over the 5-minute threshold
    const fn = vi.fn(async () => {
      throw perMinuteThrottleError(longDelaySeconds)
    })

    await expect(callWithPacingAndRetry(fn, { pacer, clock })).rejects.toBeInstanceOf(RunHaltedError)
    expect(fn).toHaveBeenCalledTimes(1) // no retry loop burned on an unresolvable wait
    expect(clock.sleeps).toEqual([]) // never slept for hours
  })

  it('stops the run on quota_exhausted wording with no retry hint at all', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(0, clock)
    const fn = vi.fn(async () => {
      throw errorWithMessage('billing: prepayment credits are depleted')
    })

    let caught: unknown
    try {
      await callWithPacingAndRetry(fn, { pacer, clock })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RunHaltedError)
    expect((caught as RunHaltedError).haltReason).toBe('daily_quota')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up and halts after maxAttempts of a rate limit that never clears', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(0, clock)
    const fn = vi.fn(async () => {
      throw perMinuteThrottleError(1) // always short — never implausibly long
    })

    let caught: unknown
    try {
      await callWithPacingAndRetry(fn, { pacer, clock, maxAttempts: 3, jitterMs: 0 })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RunHaltedError)
    expect((caught as RunHaltedError).haltReason).toBe('retries_exhausted')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a non-rate-limit error — it fails immediately like before', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(0, clock)
    const realError = errorWithMessage('schema validation failed')
    const fn = vi.fn(async () => {
      throw realError
    })

    await expect(callWithPacingAndRetry(fn, { pacer, clock })).rejects.toBe(realError)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(clock.sleeps).toEqual([])
  })

  it('respects the pacer minimum interval between consecutive successful calls', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(500, clock)
    const fn = vi.fn(async () => 'ok')

    await callWithPacingAndRetry(fn, { pacer, clock })
    await callWithPacingAndRetry(fn, { pacer, clock })

    expect(clock.sleeps).toEqual([500])
  })
})
