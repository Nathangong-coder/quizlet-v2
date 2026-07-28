export type FailureAttribution = 'user' | 'system';

export type FailureKind =
  | 'no_credentials'
  | 'invalid_key'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'unknown_model'
  | 'provider_down'
  | 'schema_invalid'
  | 'config_invalid'
  | 'internal';

/** One credential's attempt within a multi-key generation. */
export interface AttemptRow {
  /** Which credential this attempt used, so callers can flag it without
   *  re-deriving the mapping by array index. */
  credentialId: string;
  label: string;
  provider: string;
  model: string;
  kind: FailureKind;
  message: string;
}

export interface ErrorDetail {
  title: string;
  why: string;
  fix?: { label: string; href?: string };
  attribution: FailureAttribution;
  attempts?: AttemptRow[];
  technical?: string;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

/**
 * Maps a raw provider error to a kind.
 *
 * Order matters: quota exhaustion and plain rate limiting are both HTTP 429,
 * so the billing-specific wording must be tested before the generic 429 check
 * or every depleted-credits failure would be misreported as "try again soon".
 */
export function classifyProviderError(err: unknown): FailureKind {
  // Checked by error name, before any message-needle check, so this file
  // doesn't need to import `ProviderConfigError` from providers.ts — a
  // structural check on `.name` is enough and keeps the dependency direction
  // one-way (providers.ts has no reason to import from here).
  if (err instanceof Error && err.name === 'ProviderConfigError') return 'config_invalid';

  const msg = messageOf(err).toLowerCase();
  if (!msg) return 'internal';

  const is = (...needles: string[]) => needles.some((n) => msg.includes(n));

  if (is('prepayment credits', 'credits are depleted', 'billing', 'exceeded your current quota', 'insufficient_quota')) {
    return 'quota_exhausted';
  }
  if (is('429', 'too many requests', 'rate limit', 'resource_exhausted')) return 'rate_limited';
  if (is('api key not valid', 'invalid api key', 'incorrect api key', 'unauthorized', 'permission denied', '401', '403')) {
    return 'invalid_key';
  }
  if (is('is not found for api version', 'not found for api version', 'model_not_found', 'unknown model', '404')) {
    return 'unknown_model';
  }
  if (is('500', '502', '503', '504', 'overloaded', 'service unavailable', 'fetch failed', 'econnrefused', 'enotfound', 'etimedout', 'network')) {
    return 'provider_down';
  }
  return 'internal';
}

const DESCRIPTIONS: Record<FailureKind, Pick<ErrorDetail, 'title' | 'why' | 'fix' | 'attribution'>> = {
  no_credentials: {
    title: 'No AI provider configured',
    why: 'This feature needs an AI provider key, and none is saved on your account yet.',
    fix: { label: 'Add an API key', href: '/settings/ai' },
    attribution: 'user',
  },
  invalid_key: {
    title: 'API key rejected',
    why: 'The provider refused this key. It may have been revoked, mistyped, or issued for a different project.',
    fix: { label: 'Check your API keys', href: '/settings/ai' },
    attribution: 'user',
  },
  quota_exhausted: {
    title: 'Provider credits used up',
    why: 'The key reached its billing limit. This is a balance problem, not a speed problem, so retrying will not help until credits are topped up.',
    fix: { label: 'Top up, or add another key to rotation', href: '/settings/ai' },
    attribution: 'user',
  },
  rate_limited: {
    title: 'Rate limited',
    why: 'Requests went out faster than this key allows. The key itself is fine and this usually clears within a minute.',
    fix: { label: 'Add a second key to spread the load', href: '/settings/ai' },
    attribution: 'user',
  },
  unknown_model: {
    title: 'Model not available',
    why: 'The provider does not serve that model id for this key. Model availability differs between accounts, so a name that works elsewhere may not work here.',
    fix: { label: 'Pick a model and press Test', href: '/settings/ai' },
    attribution: 'user',
  },
  provider_down: {
    title: 'Provider unavailable',
    why: 'The provider could not be reached or returned a server error. Nothing is wrong with your configuration.',
    attribution: 'system',
  },
  schema_invalid: {
    title: 'Unexpected response shape',
    why: 'The model replied with data that did not match what this feature expects. This is a problem with the app, not your setup.',
    attribution: 'system',
  },
  config_invalid: {
    title: 'Credential not fully configured',
    why: 'This credential is missing a field it needs to make requests, such as a base URL for a provider that requires one.',
    fix: { label: 'Complete this credential', href: '/settings/ai' },
    attribution: 'user',
  },
  internal: {
    title: 'Something went wrong',
    why: 'An unexpected error occurred inside the app. This is not caused by your configuration.',
    attribution: 'system',
  },
};

export function describeFailure(kind: FailureKind) {
  return DESCRIPTIONS[kind];
}

/** Transient kinds worth trying another credential for. */
export function isRetryable(kind: FailureKind): boolean {
  return kind === 'rate_limited' || kind === 'provider_down';
}
