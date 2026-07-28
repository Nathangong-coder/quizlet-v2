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

  it('does not let a digit inside a 5xx body masquerade as an auth failure', () => {
    // The poisoning case. `'401'` used to be matched as a bare substring, and
    // invalid_key was tested before provider_down, so a genuine outage whose
    // body carried a trace id containing 401 badged a healthy credential as
    // having a rejected key.
    expect(
      classifyProviderError(
        new Error('[503 Service Unavailable] upstream error, trace id 7f401ab2, retry later'),
      ),
    ).toBe('provider_down');
    expect(
      classifyProviderError(new Error('[500 Internal Server Error] request 404123 failed')),
    ).toBe('provider_down');
  });

  it('prefers a structured statusCode over message wording', () => {
    // The AI SDK's APICallError carries the real status. Trusting it means a
    // 5xx status page that merely mentions billing is not reported to the user
    // as "top up your credits".
    const apiError = Object.assign(new Error('service temporarily unavailable — check billing portal'), {
      statusCode: 503,
    });
    expect(classifyProviderError(apiError)).toBe('provider_down');

    const notFound = Object.assign(new Error('the request could not be completed'), { statusCode: 404 });
    expect(classifyProviderError(notFound)).toBe('unknown_model');

    const quota = Object.assign(new Error('Your prepayment credits are depleted'), { statusCode: 429 });
    expect(classifyProviderError(quota)).toBe('quota_exhausted');

    const busy = Object.assign(new Error('slow down'), { statusCode: 429 });
    expect(classifyProviderError(busy)).toBe('rate_limited');
  });

  it('classifies an AI SDK structured-output failure as schema_invalid', () => {
    // What `generateText({ output: Output.object({ schema }) })` throws when
    // the reply cannot be parsed or fails validation. Matched by the SDK's
    // stable error name, the same way ProviderConfigError is.
    const noObject = new Error('No object generated: response did not match schema.');
    noObject.name = 'AI_NoObjectGeneratedError';
    expect(classifyProviderError(noObject)).toBe('schema_invalid');

    const typeError = new Error('Type validation failed');
    typeError.name = 'AI_TypeValidationError';
    expect(classifyProviderError(typeError)).toBe('schema_invalid');

    const parseError = new Error('JSON parsing failed');
    parseError.name = 'AI_JSONParseError';
    expect(classifyProviderError(parseError)).toBe('schema_invalid');
  });

  it('falls back to internal for anything unrecognised', () => {
    expect(classifyProviderError(new Error('something bizarre'))).toBe('internal');
    expect(classifyProviderError(null)).toBe('internal');
  });

  it('classifies a ProviderConfigError as config_invalid, by name not message', () => {
    class ProviderConfigError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ProviderConfigError';
      }
    }
    expect(classifyProviderError(new ProviderConfigError('OpenRouter needs a base URL. Add one in AI settings.')))
      .toBe('config_invalid');
  });
});

describe('describeFailure', () => {
  it('attributes user-fixable kinds to the user and gives each a fix', () => {
    const userKinds: FailureKind[] = [
      'no_credentials', 'credentials_unavailable', 'invalid_key', 'quota_exhausted',
      'rate_limited', 'unknown_model',
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

  it('separates "no keys at all" from "keys exist but none is usable"', () => {
    // Telling a user with four working keys that none is saved sent them off
    // to add a fifth instead of to the routing pin that was the real cause.
    expect(describeFailure('no_credentials').why).toContain('none is saved on your account yet');
    const unusable = describeFailure('credentials_unavailable');
    expect(unusable.why).not.toContain('none is saved on your account yet');
    expect(unusable.fix?.href).toBe('/settings/ai');
  });

  it('attributes a misconfigured credential to the user, with a fix', () => {
    const d = describeFailure('config_invalid');
    expect(d.attribution).toBe('user');
    expect(d.fix).toBeDefined();
    expect(d.fix?.href).toBe('/settings/ai');
    expect(d.why.length).toBeGreaterThan(0);
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

  it('does not retry a misconfigured credential', () => {
    expect(isRetryable('config_invalid')).toBe(false);
  });

  it('does not retry an unusable credential pool — nothing changes on its own', () => {
    expect(isRetryable('credentials_unavailable')).toBe(false);
  });
});
