export type FailureAttribution = 'user' | 'system';

export type FailureKind =
  | 'no_credentials'
  | 'credentials_unavailable'
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
 * The HTTP status the provider actually returned, when it is knowable.
 *
 * The AI SDK throws `APICallError`, which carries a real numeric `statusCode`.
 * That is far more trustworthy than scanning the message for `'401'`/`'404'`:
 * a genuine 503 whose body happens to embed a trace id containing `401` used
 * to classify as `invalid_key` and badge a perfectly healthy credential as
 * broken. Read structurally (duck-typed on `.statusCode`) rather than by
 * importing `APICallError` from `ai`, so this module stays dependency-free and
 * safe to bundle into client components.
 */
function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number' && code >= 100 && code < 600) return code;
  }
  return undefined;
}

/**
 * Last-resort status extraction for providers that only put the code in the
 * message (e.g. Google's `[429 Too Many Requests] ...`). Anchored to the
 * shapes providers actually emit — a bracketed prefix, or an explicit
 * "status"/"HTTP" label — never a bare three-digit substring, which is what
 * let trace ids poison the classification.
 */
const STATUS_PATTERNS = [
  /\[(\d{3})[\s\]]/,
  /\bstatus(?:\s*code)?[:\s]+(\d{3})\b/i,
  /\bhttp[/ ](?:\d\.\d\s+)?(\d{3})\b/i,
];

function statusFromMessage(msg: string): number | undefined {
  for (const pattern of STATUS_PATTERNS) {
    const match = pattern.exec(msg);
    if (match) return Number(match[1]);
  }
  return undefined;
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

  // The AI SDK's `Output.object({ schema })` throws `NoObjectGeneratedError`
  // when the reply cannot be parsed or fails schema validation — the only way
  // `schema_invalid` is reachable. Matched on the SDK's stable error names
  // (`AISDKError` assigns `name` from its marker) for the same no-import
  // reason as above; `TypeValidationError`/`JSONParseError` are the causes it
  // wraps and can also surface directly from other SDK entry points.
  if (
    err instanceof Error &&
    (err.name === 'AI_NoObjectGeneratedError' ||
      err.name === 'AI_TypeValidationError' ||
      err.name === 'AI_JSONParseError')
  ) {
    return 'schema_invalid';
  }

  const msg = messageOf(err).toLowerCase();
  const is = (...needles: string[]) => needles.some((n) => msg.includes(n));
  const quotaWording = () =>
    is('prepayment credits', 'credits are depleted', 'billing', 'exceeded your current quota', 'insufficient_quota');

  // A real status code beats message wording. `billing` in particular is a
  // broad needle: a 5xx status page that merely mentions billing must not be
  // reported to the user as "top up your credits".
  const status = statusOf(err) ?? statusFromMessage(msg);
  if (status !== undefined) {
    if (status >= 500) return 'provider_down';
    if (status === 429) return quotaWording() ? 'quota_exhausted' : 'rate_limited';
    if (status === 402) return 'quota_exhausted';
    if (status === 401 || status === 403) return 'invalid_key';
    if (status === 404) return 'unknown_model';
    // Any other 4xx carries no consistent meaning across providers, so fall
    // through to the wording checks below.
  }

  if (!msg) return 'internal';

  if (quotaWording()) return 'quota_exhausted';
  if (is('too many requests', 'rate limit', 'resource_exhausted')) return 'rate_limited';
  if (is('api key not valid', 'invalid api key', 'incorrect api key', 'unauthorized', 'permission denied')) {
    return 'invalid_key';
  }
  if (is('is not found for api version', 'not found for api version', 'model_not_found', 'unknown model')) {
    return 'unknown_model';
  }
  if (is('overloaded', 'service unavailable', 'fetch failed', 'econnrefused', 'enotfound', 'etimedout', 'network')) {
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
  credentials_unavailable: {
    // Distinct from `no_credentials`: keys DO exist, but none of them is
    // usable for this call. Telling a user with four working keys that they
    // have none — the old behaviour when task routing pinned a disabled
    // credential — sent them to add a fifth instead of to the real cause.
    title: 'No usable AI key for this task',
    why: 'You have AI keys saved, but none of them can run this task right now.',
    fix: { label: 'Review your AI settings', href: '/settings/ai' },
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
