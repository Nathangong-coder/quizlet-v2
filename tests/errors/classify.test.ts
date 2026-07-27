import { describe, it, expect } from 'vitest';
import {
  classifyProviderError,
  describeFailure,
  isRetryable,
  type FailureKind,
} from '@/lib/errors/classify';

/**
 * Fixtures are the literal strings observed in production on 2026-07-27, not
 * paraphrases. Two of these are both HTTP 429 but need opposite user actions,
 * which is exactly what the original single-line error hid.
 */
const REAL_QUOTA_429 =
  '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent: [429 Too Many Requests] Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.';

const REAL_UNKNOWN_MODEL_404 =
  '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent: [404 Not Found] models/gemini-3-flash is not found for API version v1beta, or is not supported for generateContent.';

describe('classifyProviderError', () => {
  it('separates depleted credits from plain rate limiting despite both being 429', () => {
    expect(classifyProviderError(new Error(REAL_QUOTA_429))).toBe('quota_exhausted');
    expect(classifyProviderError(new Error('[429 Too Many Requests] Rate limit exceeded, retry shortly'))).toBe('rate_limited');
  });

  it('classifies a nonexistent model id', () => {
    expect(classifyProviderError(new Error(REAL_UNKNOWN_MODEL_404))).toBe('unknown_model');
  });

  it('classifies a rejected key', () => {
    expect(classifyProviderError(new Error('[401] API key not valid. Please pass a valid API key.'))).toBe('invalid_key');
    expect(classifyProviderError(new Error('[403 Forbidden] permission denied'))).toBe('invalid_key');
  });

  it('classifies provider outages and network faults', () => {
    expect(classifyProviderError(new Error('[503 Service Unavailable] overloaded'))).toBe('provider_down');
    expect(classifyProviderError(new Error('fetch failed: ECONNREFUSED'))).toBe('provider_down');
  });

  it('falls back to internal for anything unrecognised', () => {
    expect(classifyProviderError(new Error('something bizarre'))).toBe('internal');
    expect(classifyProviderError(null)).toBe('internal');
  });
});

describe('describeFailure', () => {
  it('attributes user-fixable kinds to the user and gives each a fix', () => {
    const userKinds: FailureKind[] = [
      'no_credentials', 'invalid_key', 'quota_exhausted', 'rate_limited', 'unknown_model',
    ];
    for (const kind of userKinds) {
      const d = describeFailure(kind);
      expect(d.attribution).toBe('user');
      expect(d.fix).toBeDefined();
      expect(d.why.length).toBeGreaterThan(0);
    }
  });

  it('attributes provider and program faults to the system with no fix to offer', () => {
    for (const kind of ['provider_down', 'schema_invalid', 'internal'] as FailureKind[]) {
      const d = describeFailure(kind);
      expect(d.attribution).toBe('system');
      expect(d.fix).toBeUndefined();
    }
  });

  it('points key problems at the settings page', () => {
    expect(describeFailure('no_credentials').fix?.href).toBe('/settings/ai');
    expect(describeFailure('invalid_key').fix?.href).toBe('/settings/ai');
  });
});

describe('isRetryable', () => {
  it('retries transient kinds only', () => {
    expect(isRetryable('rate_limited')).toBe(true);
    expect(isRetryable('provider_down')).toBe(true);
    expect(isRetryable('invalid_key')).toBe(false);
    expect(isRetryable('unknown_model')).toBe(false);
    expect(isRetryable('quota_exhausted')).toBe(false);
  });
});
