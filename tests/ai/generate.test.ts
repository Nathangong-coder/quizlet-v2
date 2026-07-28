import { describe, it, expect } from 'vitest';
import { runAttempts, AiGenerationError, type AttemptCandidate } from '@/lib/ai/generate';

const candidate = (over: Partial<AttemptCandidate> & { id: string }): AttemptCandidate => ({
  label: over.id,
  provider: 'google',
  model: 'gemini-3.6-flash',
  ...over,
});

describe('runAttempts', () => {
  it('returns the first success without trying later candidates', async () => {
    const tried: string[] = [];
    const result = await runAttempts(
      [candidate({ id: 'a' }), candidate({ id: 'b' })],
      async (c) => {
        tried.push(c.id);
        return `ok:${c.id}`;
      },
    );
    expect(result.value).toBe('ok:a');
    expect(result.usedId).toBe('a');
    expect(tried).toEqual(['a']);
  });

  it('advances past a retryable failure to the next candidate', async () => {
    const result = await runAttempts(
      [candidate({ id: 'a' }), candidate({ id: 'b' })],
      async (c) => {
        if (c.id === 'a') throw new Error('[429 Too Many Requests] rate limit exceeded');
        return 'ok';
      },
    );
    expect(result.value).toBe('ok');
    expect(result.usedId).toBe('b');
  });

  it('also advances past a fatal-for-this-credential failure', async () => {
    const result = await runAttempts(
      [candidate({ id: 'a' }), candidate({ id: 'b' })],
      async (c) => {
        if (c.id === 'a') throw new Error('[401] API key not valid');
        return 'ok';
      },
    );
    expect(result.value).toBe('ok');
    expect(result.failures[0].kind).toBe('invalid_key');
  });

  it('aggregates EVERY attempt, not just the last, when all fail', async () => {
    // The whole point: the original bug was invisible because only the final
    // error surfaced, hiding that two keys were billing-blocked while three
    // model ids simply did not exist.
    const candidates = [
      candidate({ id: 'a', label: 'Google A' }),
      candidate({ id: 'b', label: 'Google B' }),
      candidate({ id: 'c', label: 'OpenRouter', provider: 'openrouter', model: 'bogus' }),
    ];
    const err = await runAttempts(candidates, async (c) => {
      if (c.id === 'c') throw new Error('[404 Not Found] is not found for API version v1beta');
      throw new Error('Your prepayment credits are depleted');
    }).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(AiGenerationError);
    const detail = (err as AiGenerationError).detail;
    expect(detail.attempts).toHaveLength(3);
    expect(detail.attempts!.map((a) => a.kind)).toEqual([
      'quota_exhausted', 'quota_exhausted', 'unknown_model',
    ]);
    expect(detail.attempts!.map((a) => a.label)).toEqual(['Google A', 'Google B', 'OpenRouter']);
  });

  it('reports no_credentials when the pool is empty', async () => {
    const err = await runAttempts([], async () => 'never').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AiGenerationError);
    expect((err as AiGenerationError).detail.attribution).toBe('user');
    expect((err as AiGenerationError).detail.fix?.href).toBe('/settings/ai');
  });

  it('summarises with the most actionable kind when kinds differ', async () => {
    // quota_exhausted is user-fixable and should win over a system-attributed
    // provider outage, so the dialog leads with the thing the user can act on.
    const err = await runAttempts(
      [candidate({ id: 'a' }), candidate({ id: 'b' })],
      async (c) => {
        if (c.id === 'a') throw new Error('[503] service unavailable');
        throw new Error('Your prepayment credits are depleted');
      },
    ).then(() => null, (e) => e);
    expect((err as AiGenerationError).detail.attribution).toBe('user');
  });
});
