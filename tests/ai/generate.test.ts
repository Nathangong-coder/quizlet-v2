import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { runAttempts, flagworthyFailures, generateJson, AiGenerationError, type AttemptCandidate } from '@/lib/ai/generate';
import type { AttemptRow, FailureKind } from '@/lib/errors/classify';

/**
 * Mocked-prisma harness for the D6 fail-loud path below, matching the pattern
 * in tests/ai/generate-pool.test.ts: `prisma` is dynamically imported inside
 * `generateJson`, so a module mock reaches it with no real database.
 */
const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  groupBy: vi.fn(),
  createMany: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    aiCredential: { findMany: h.findMany, update: h.update, updateMany: h.updateMany },
    aiTaskRouting: { findUnique: h.findUnique },
    aiCallLog: { findMany: vi.fn().mockResolvedValue([]), groupBy: h.groupBy, createMany: h.createMany },
  },
}));

vi.mock('ai', () => ({
  generateText: h.generateText,
  Output: { object: (opts: unknown) => opts },
}));

vi.mock('@/lib/security/api-key', () => ({
  decryptApiKey: (value: string) => `decrypted:${value}`,
}));

vi.mock('@/lib/ai/providers', () => ({
  AI_PROVIDERS: ['google', 'anthropic', 'openai', 'openrouter', 'deepseek', 'zai', 'custom'],
  resolveLanguageModel: (args: unknown) => args,
}));

const candidate = (over: Partial<AttemptCandidate> & { id: string }): AttemptCandidate => ({
  label: over.id,
  provider: 'google',
  model: 'gemini-3.6-flash',
  ...over,
});

const row = (id: string, kind: FailureKind): AttemptRow => ({
  credentialId: id,
  label: id,
  provider: 'google',
  model: 'gemini-3.6-flash',
  kind,
  message: `simulated ${kind}`,
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

  it('still surfaces flagworthy rows via the thrown detail when every candidate fails', async () => {
    // generateJson has no `runAttempts` return value to flag from in the
    // all-fail case (it throws), so the caller must derive flagworthy rows
    // from `err.detail.attempts` instead. This is what that path exercises,
    // without needing a database.
    const err = await runAttempts(
      [candidate({ id: 'a' }), candidate({ id: 'b' })],
      async (c) => {
        if (c.id === 'a') throw new Error('[401] API key not valid');
        throw new Error('[429 Too Many Requests] rate limit exceeded');
      },
    ).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(AiGenerationError);
    const attempts = (err as AiGenerationError).detail.attempts!;
    expect(attempts).toHaveLength(2);
    const flagworthy = flagworthyFailures(attempts);
    expect(flagworthy.map((f) => f.credentialId)).toEqual(['a']);
    expect(flagworthy[0].kind).toBe('invalid_key');
  });
});

describe('flagworthyFailures', () => {
  it('keeps user-fixable, non-retryable kinds', () => {
    const rows = [row('a', 'invalid_key'), row('b', 'unknown_model'), row('c', 'quota_exhausted')];
    expect(flagworthyFailures(rows).map((f) => f.credentialId)).toEqual(['a', 'b', 'c']);
  });

  it('drops retryable kinds even though they are user-attributed', () => {
    const rows = [row('a', 'rate_limited'), row('b', 'provider_down')];
    expect(flagworthyFailures(rows)).toEqual([]);
  });

  it('drops system-attributed kinds even though they are non-retryable', () => {
    // The regression this guards: `internal`/`schema_invalid` are app bugs,
    // not credential problems. Badging a healthy key for one of these is
    // exactly the "train the user to ignore the badge" outcome the function
    // exists to prevent, just from the opposite direction.
    const rows = [row('a', 'internal'), row('b', 'schema_invalid')];
    expect(flagworthyFailures(rows)).toEqual([]);
  });

  it('attributes by credentialId, not array position', () => {
    const rows = [row('x', 'rate_limited'), row('y', 'invalid_key'), row('z', 'internal')];
    expect(flagworthyFailures(rows).map((f) => f.credentialId)).toEqual(['y']);
  });
});

/**
 * D6's fail-loud path (Spec 5 Phase A, Task 7): a strict `z.enum(...)`
 * rejecting the model's reply must not vanish into a generic "unexpected
 * response shape" — the offending value is recorded on the `AiCallLog` row so
 * it is visible on /staff/ai-history, not just as the categorical
 * `failureKind: 'schema_invalid'`.
 */
describe('generateJson — unknown enum values are logged, not swallowed', () => {
  const GOOGLE = {
    id: 'google-1',
    userId: 'u1',
    provider: 'google',
    label: 'Google',
    encryptedApiKey: 'enc',
    keyHint: 'AIza…abcd',
    baseUrl: null,
    defaultModel: 'gemini-3.6-flash',
    role: 'primary',
    enabled: true,
    shared: false,
    sharedTokenBudget: null,
    lastUsedAt: null,
    lastErrorAt: null,
    lastErrorKind: null,
    verifiedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.findMany.mockResolvedValue([GOOGLE]);
    h.findUnique.mockResolvedValue(null);
    h.groupBy.mockResolvedValue([]);
    h.update.mockResolvedValue({});
    h.updateMany.mockResolvedValue({ count: 1 });
    h.createMany.mockResolvedValue({ count: 0 });
  });

  /**
   * Builds the same real AI SDK v7 chain the classify.ts tests verify:
   * `NoObjectGeneratedError.cause` is an `AI_TypeValidationError` carrying
   * `.value` (the full object that failed validation), whose own `.cause` is
   * the real `ZodError`.
   */
  function unknownEnumError(receivedLabel: string) {
    const zodError = Object.assign(new Error('Invalid enum value'), {
      issues: [{ code: 'invalid_value', values: ['correct', 'partial', 'failed'], path: ['klpResults', 0, 'status'] }],
    });
    const typeValidationError = Object.assign(new Error('Type validation failed'), {
      name: 'AI_TypeValidationError',
      value: { klpResults: [{ status: receivedLabel }] },
      cause: zodError,
    });
    return Object.assign(new Error('No object generated: response did not match schema.'), {
      name: 'AI_NoObjectGeneratedError',
      cause: typeValidationError,
    });
  }

  it('records the received value on the AiCallLog row for a Zod enum failure', async () => {
    h.generateText.mockRejectedValue(unknownEnumError('bogus_label'));

    await expect(
      generateJson({ userId: 'u1', task: 'grade', schema: z.object({ ok: z.boolean() }), prompt: 'hi' }),
    ).rejects.toBeInstanceOf(AiGenerationError);

    // The single Google credential fans out across its approved alternate
    // models for a policed task (see credential-pool.ts), so more than one
    // attempt row is expected here — every one hit the SAME mocked rejection,
    // so every one must carry the value.
    expect(h.createMany).toHaveBeenCalledTimes(1);
    const rows = (h.createMany.mock.calls[0][0] as { data: { error?: string }[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.error).toContain('unknown value: bogus_label');
    }
  });

  it('surfaces the same value on the thrown aggregate error detail', async () => {
    h.generateText.mockRejectedValue(unknownEnumError('bogus_label'));

    const err = await generateJson({
      userId: 'u1', task: 'grade', schema: z.object({ ok: z.boolean() }), prompt: 'hi',
    }).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(AiGenerationError);
    expect((err as AiGenerationError).detail.value).toBe('bogus_label');
  });
});
