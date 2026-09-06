import 'server-only';

// `@/lib/db` is imported lazily (dynamic import) inside `generateJson` rather
// than at module scope, for the same reason and matching the existing pattern
// in src/lib/ai/media.ts (`const { prisma } = await import('@/lib/db')`):
// src/lib/db.ts throws at *import time* if DATABASE_URL is unset, and eagerly
// constructs a real Neon-backed PrismaClient. A top-level import would make
// this file's pure, injected-executor logic (the whole point of `runAttempts`)
// unloadable without a live database configured.
import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import {
  classifyProviderError,
  describeFailure,
  isRetryable,
  type AttemptRow,
  type ErrorDetail,
  type FailureKind,
} from '@/lib/errors/classify';
import { decryptApiKey } from '@/lib/security/api-key';
import { selectAttemptOrder } from '@/lib/ai/key-pool';
import { resolveLanguageModel, type ProviderId } from '@/lib/ai/providers';
import { toSdkContent, type GeminiPart } from '@/lib/ai/media-adapter';
// AiTask is declared once, in model-routing.ts (it already exports it today).
// Do not re-declare it here — two definitions would drift.
import type { AiTask } from '@/lib/ai/model-routing';
import { temperatureForTask } from '@/lib/ai/temperature';
import { enforceModelPolicy } from '@/lib/ai/model-policy';

/**
 * What the executor needs to know about its position in the rotation.
 *
 * Only `isLast` so far, and it exists for retry policy: with another credential
 * still to try, rotating is a better answer to a failure than retrying the same
 * key, so the SDK's own retries are turned off. On the LAST credential there is
 * nothing to rotate to, and the SDK's retry is the only resilience left.
 */
export interface AttemptMeta {
  isLast: boolean;
}

/** One credential resolved far enough to attempt a call with. */
export interface AttemptCandidate {
  id: string;
  label: string;
  provider: string;
  model: string;
}

export interface AttemptSuccess<T> {
  value: T;
  usedId: string;
  failures: AttemptRow[];
}

export class AiGenerationError extends Error {
  constructor(public detail: ErrorDetail) {
    super(detail.title);
    this.name = 'AiGenerationError';
  }
}

/** User-fixable kinds lead the summary over system-attributed ones. */
function mostActionable(kinds: FailureKind[]): FailureKind {
  const userKind = kinds.find((k) => describeFailure(k).attribution === 'user');
  return userKind ?? kinds[0] ?? 'internal';
}

/**
 * Walks candidates until one succeeds.
 *
 * `execute` is injected so the ordering, classification, and aggregation logic
 * is testable without network or database access.
 *
 * On total failure the thrown detail lists EVERY attempt. Reporting only the
 * last error is what made the 2026-07-27 outage unreadable: two credentials
 * were billing-blocked and three model ids did not exist, but only the final
 * 404 was surfaced.
 */
export async function runAttempts<T>(
  candidates: AttemptCandidate[],
  execute: (candidate: AttemptCandidate, meta: AttemptMeta) => Promise<T>,
): Promise<AttemptSuccess<T>> {
  if (candidates.length === 0) {
    throw new AiGenerationError({
      ...describeFailure('no_credentials'),
      attempts: [],
    });
  }

  const failures: AttemptRow[] = [];

  for (const [index, candidate] of candidates.entries()) {
    try {
      const value = await execute(candidate, { isLast: index === candidates.length - 1 });
      return { value, usedId: candidate.id, failures };
    } catch (err) {
      const kind = classifyProviderError(err);
      failures.push({
        credentialId: candidate.id,
        label: candidate.label,
        provider: candidate.provider,
        model: candidate.model,
        kind,
        message: err instanceof Error ? err.message : String(err),
      });
      // Every kind advances to the next credential. The retryable/fatal
      // distinction is consumed by callers via `flagworthyFailures` below.
    }
  }

  const summaryKind = mostActionable(failures.map((f) => f.kind));
  throw new AiGenerationError({
    ...describeFailure(summaryKind),
    title: `All ${failures.length} AI attempt${failures.length === 1 ? '' : 's'} failed`,
    attempts: failures,
    technical: failures.map((f) => `${f.label} / ${f.model}: ${f.message}`).join('\n\n'),
  });
}

/**
 * Failures worth flagging on the credential itself in the settings UI.
 *
 * A row is flagworthy only if it is BOTH user-attributed AND non-retryable.
 * Retryable kinds are excluded because a transient 429 clears on its own, and
 * badging a perfectly good key as broken because it was briefly busy would
 * train the user to ignore the badge. System-attributed kinds (`internal`,
 * `schema_invalid`, `provider_down`) are excluded too — those are app or
 * provider bugs, not something wrong with the credential, so stamping them
 * onto a healthy key would be the exact same "ignore the badge" outcome from
 * the other direction. Only kinds needing human action on the credential
 * itself (invalid_key, unknown_model, quota_exhausted, config_invalid)
 * persist.
 */
export function flagworthyFailures(failures: AttemptRow[]): AttemptRow[] {
  return failures.filter(
    (f) => describeFailure(f.kind).attribution === 'user' && !isRetryable(f.kind),
  );
}

/** One attempt, as it will be stored. */
export interface AiCallRecord {
  userId: string;
  task: AiTask;
  provider: string;
  model: string;
  credentialId: string;
  credentialLabel: string;
  ok: boolean;
  failureKind: FailureKind | null;
  latencyMs: number;
}

/**
 * Persists attempt logs. NEVER THROWS.
 *
 * Benchmarking data is worth having and is not worth failing a user's grading
 * over. If the insert fails the generation still succeeded, and the honest
 * outcome is a gap in the log rather than an error the caller cannot act on.
 */
export async function recordAiCalls(prisma: PrismaClient, calls: AiCallRecord[]): Promise<void> {
  if (calls.length === 0) return;
  try {
    await prisma.aiCallLog.createMany({ data: calls });
  } catch (err) {
    console.error('Failed to record AI call log', err);
  }
}

export interface GenerateJsonInput<T> {
  userId: string;
  task: AiTask;
  schema: z.ZodSchema<T>;
  prompt?: string;
  parts?: GeminiPart[];
  /**
   * Ceiling on the model's OUTPUT tokens, reasoning included. Omitted, the
   * provider default applies, which is what every call site did until the
   * diagnostic needed otherwise.
   *
   * It exists because reasoning tokens are invisible until they run out.
   * Measured on gemini-3.5-flash: grading one diagnostic answer costs ~900
   * output tokens of which ~92% are REASONING, so a four-question grading call
   * hit the default ceiling and came back `finishReason: 'length'` — which the
   * SDK surfaces as `NoObjectGeneratedError`, i.e. `schema_invalid`, so it
   * reads as a model that cannot follow a schema rather than one that ran out
   * of room. Batching alone did not fix it: two batches succeeded and the
   * third did not, because the budget is per call and reasoning varies.
   *
   * Set it on any task whose output scales with its input.
   */
  maxOutputTokens?: number;
}

/**
 * Stamps flagworthy failures onto their credentials. Shared by the
 * some-succeeded and all-failed paths in `generateJson` so there is one
 * implementation of "how a failure gets written to a credential", not two
 * copies that can drift.
 */
async function flagFailures(
  prisma: PrismaClient,
  userId: string,
  rows: AttemptRow[],
): Promise<void> {
  await Promise.all(
    rows.map((f) =>
      prisma.aiCredential.updateMany({
        where: { id: f.credentialId, userId },
        data: { lastErrorAt: new Date(), lastErrorKind: f.kind },
      }),
    ),
  );
}

type CredentialRow = Awaited<ReturnType<PrismaClient['aiCredential']['findMany']>>[number];

interface ResolvedPool {
  candidates: AttemptCandidate[];
  byId: Map<string, CredentialRow>;
  /** Every credential on the account, before eligibility or enabled filtering. */
  allCredentials: CredentialRow[];
  /** The credential `AiTaskRouting` pins this task to, when it pins one. */
  pinned: CredentialRow | null;
}

/**
 * Resolves the ordered candidate pool for a user/task: which credentials are
 * eligible (narrowed to one if `AiTaskRouting` pins the task to a specific
 * credential), in LRU-first/primary-before-backup order, each carrying the
 * model it would be attempted with.
 *
 * Shared by `generateJson` (which attempts every candidate in order, with
 * failover) and `resolveTaskModel` (which only needs the first one) so the
 * two can never drift apart into disagreeing about what "the model for this
 * task" means.
 */
async function resolveCandidates(
  prisma: PrismaClient,
  userId: string,
  task: AiTask,
): Promise<ResolvedPool> {
  const [credentials, routing] = await Promise.all([
    prisma.aiCredential.findMany({ where: { userId } }),
    prisma.aiTaskRouting.findUnique({ where: { userId_task: { userId, task } } }),
  ]);

  // A routing row pinned to one credential narrows the pool to it; otherwise
  // every credential is eligible. A dangling credentialId is impossible —
  // the FK is ON DELETE SET NULL.
  const pinned = routing?.credentialId
    ? credentials.find((c) => c.id === routing.credentialId) ?? null
    : null;
  const eligible = routing?.credentialId ? credentials.filter((c) => c.id === routing.credentialId) : credentials;

  const ordered = selectAttemptOrder(
    eligible.map((c) => ({
      id: c.id,
      role: c.role === 'backup' ? ('backup' as const) : ('primary' as const),
      enabled: c.enabled,
      lastUsedAt: c.lastUsedAt,
    })),
  );

  // A model id is provider-specific and meaningless across a heterogeneous
  // pool: `gemini-3-pro` is not a name Anthropic serves, and
  // `claude-sonnet-4-5` is not one Google serves. So the routing model
  // override applies ONLY to the credential it was chosen alongside — i.e.
  // only when `routing.credentialId` narrowed the pool to exactly that one.
  // With no pinned credential the override is dropped and every candidate
  // uses its own `defaultModel`; applying it pool-wide would 404 on every
  // provider that does not serve the id, and `unknown_model` is
  // user-attributed and non-retryable, so it would badge healthy credentials
  // as broken in settings — the exact false-badge `flagworthyFailures` exists
  // to prevent.
  const overrideModel = routing?.credentialId ? routing.model : null;

  const byId = new Map(credentials.map((c) => [c.id, c]));
  const candidates = ordered.map((o) => {
    const cred = byId.get(o.id)!;
    // The quality floor is applied HERE, not only in `saveTaskRouting`,
    // because the model reaches this point from two places and the form can
    // only validate one of them. `AiTaskRouting.model` is a per-task override
    // and is checked on save; `AiCredential.defaultModel` is not, and cannot
    // be — one credential serves every task, so a default that is wrong for
    // grading may be perfectly reasonable elsewhere. Most users never set a
    // per-task override at all, so validating only the form would leave the
    // common path unpoliced. See `src/lib/ai/model-policy.ts`.
    const { model } = enforceModelPolicy(cred.provider, overrideModel ?? cred.defaultModel, task);
    return {
      id: cred.id,
      label: cred.label,
      provider: cred.provider,
      model,
    };
  });

  return { candidates, byId, allCredentials: credentials, pinned };
}

/**
 * Why an empty candidate pool happened, phrased so the user can act on it.
 *
 * `no_credentials` ("none is saved on your account yet") is only true when the
 * account genuinely has zero keys. Reaching it with four working keys saved —
 * which happens the moment task routing pins a disabled credential — sends the
 * user off to add another key instead of to the switch that is actually off,
 * three screens away. Pure and exported so the two reachable non-empty cases
 * are testable without a database.
 */
export function describeEmptyPool(pool: Pick<ResolvedPool, 'allCredentials' | 'pinned'>): ErrorDetail {
  if (pool.allCredentials.length === 0) {
    return { ...describeFailure('no_credentials'), attempts: [] };
  }

  const base = describeFailure('credentials_unavailable');
  const why = pool.pinned
    ? `Task routing sends this feature to the credential "${pool.pinned.label}", but that credential is turned off. The pin overrides the normal fallback order, so your other keys are not tried.`
    : 'Every AI key saved on your account is currently turned off, so there is nothing left to try.';

  return { ...base, why, attempts: [] };
}

/**
 * The model a task will be attempted with first, resolved the same way
 * `generateJson` resolves it (see `resolveCandidates`). Exposed so callers
 * that cache per-model (e.g. `QuizOptionCache`) can compute a cache key
 * BEFORE the generation call — the pool rotates LRU-first and fails over on
 * error, so the model that ultimately serves a request is not knowable in
 * advance, but the user's configured intent (their primary credential's
 * model, right now) is. Returns `null` when the user has no usable
 * credential for this task, in which case `generateJson` would fail with
 * `no_credentials` anyway.
 */
export async function resolveTaskModel(userId: string, task: AiTask): Promise<string | null> {
  const { prisma } = await import('@/lib/db');
  const { candidates } = await resolveCandidates(prisma, userId, task);
  return candidates[0]?.model ?? null;
}

/** What actually served a request, once rotation has settled. */
export interface GenerationMeta {
  /** The model that produced the value — the one that SUCCEEDED, not the one tried first. */
  model: string
  provider: string
  credentialId: string
  credentialLabel: string
  /** How many credentials had to fail before this one worked. 0 on a clean first attempt. */
  failedAttempts: number
}

/**
 * The single generation entry point. Call sites name a task; credential
 * selection, decryption, rotation, and failure aggregation happen here.
 */
export async function generateJson<T>(input: GenerateJsonInput<T>): Promise<T> {
  const { value } = await generateJsonWithMeta(input);
  return value;
}

/**
 * `generateJson`, plus which credential and model actually served it.
 *
 * Rotation does not make the served model unknowable — it just means it is not
 * knowable in ADVANCE. By the time the value is in hand, exactly one attempt
 * succeeded and its model is a fact. Callers that persist an artifact (KLP
 * authoring writes `CardAuthoring.model`) need that fact, and were previously
 * told to leave it null on the pooled path for no good reason.
 *
 * `generateJson` stays the default so the twenty-odd call sites that do not
 * care are unaffected.
 */
export async function generateJsonWithMeta<T>({
  userId, task, schema, prompt, parts, maxOutputTokens,
}: GenerateJsonInput<T>): Promise<{ value: T; meta: GenerationMeta }> {
  const { prisma } = await import('@/lib/db');

  const pool = await resolveCandidates(prisma, userId, task);
  const { candidates, byId } = pool;

  // An empty pool has three causes and only one of them is "you have no keys".
  // `runAttempts` cannot tell them apart (it only sees the candidate array),
  // so the distinction is drawn here, where the credential rows are in hand.
  if (candidates.length === 0) {
    throw new AiGenerationError(describeEmptyPool(pool));
  }

  // One row per ATTEMPT, written after the call resolves either way. Collected
  // rather than written inline so a slow log never sits between the user and
  // their answer, and so a failed attempt is recorded as faithfully as a
  // successful one — which models fail, on which task, is the whole point.
  const calls: AiCallRecord[] = [];

  let result: AttemptSuccess<T>;
  try {
    result = await runAttempts(candidates, async (candidate, { isLast }) => {
      const cred = byId.get(candidate.id)!;

      // Stamped BEFORE the attempt, not after it. The field is therefore
      // "least recently *tried*", which is the only basis that spreads load
      // under concurrency: the app's main burst path (MultipleChoiceQuiz fans
      // one action out per card via Promise.all) fires N requests that all
      // read `lastUsedAt` before any of them finishes, so stamping on success
      // sent every one of them to the SAME primary credential and then failed
      // them all over on the resulting 429s. Failure flagging is unaffected —
      // that still keys off the attempt outcome below.
      await prisma.aiCredential.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() },
      });

      const model = resolveLanguageModel({
        provider: cred.provider as ProviderId,
        apiKey: decryptApiKey(cred.encryptedApiKey),
        baseUrl: cred.baseUrl,
        model: candidate.model,
      });

      // TWO RETRY AUTHORITIES MULTIPLY RATHER THAN COMPOSE. The SDK's default
      // `maxRetries` is 2, i.e. three attempts, all against the SAME key —
      // so a rate-limited credential burned three requests before this loop
      // ever saw a failure and rotated. On a per-day quota (Gemini's free tier
      // is 20 requests/day/model) that is three times the waste, and it also
      // tripled the latency before failover on a key that was never going to
      // work.
      //
      // So: while another credential remains, rotation IS the retry — a
      // different key is a strictly better second attempt than the same one.
      // On the last credential there is nothing to rotate to, and the SDK's
      // retry is the only resilience left, so it is kept. A single-credential
      // user therefore sees no change at all.
      const startedAt = Date.now();
      try {
        const { output } = await generateText({
          model,
          output: Output.object({ schema }),
          maxRetries: isLast ? 2 : 0,
          // Per TASK, and never left unset. Until 2026-09-06 nothing here set a
          // temperature, so every judgment ran at the provider default of 1.0 —
          // see src/lib/ai/temperature.ts for the repetition loop and the
          // cross-script drift that produced.
          temperature: temperatureForTask(task),
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          ...(parts ? { messages: [{ role: 'user' as const, content: toSdkContent(parts) }] } : { prompt: prompt ?? '' }),
        });
        calls.push({
          userId, task,
          provider: cred.provider,
          model: candidate.model,
          credentialId: cred.id,
          credentialLabel: cred.label,
          ok: true,
          failureKind: null,
          latencyMs: Date.now() - startedAt,
        });
        return output as T;
      } catch (err) {
        calls.push({
          userId, task,
          provider: cred.provider,
          model: candidate.model,
          credentialId: cred.id,
          credentialLabel: cred.label,
          ok: false,
          failureKind: classifyProviderError(err),
          latencyMs: Date.now() - startedAt,
        });
        throw err;
      }
    });
  } catch (err) {
    // Every credential failed, so `runAttempts` threw instead of returning —
    // this is exactly the scenario the settings badge exists for, so it must
    // be flagged here too, not just on the some-succeeded path below.
    if (err instanceof AiGenerationError && err.detail.attempts?.length) {
      await flagFailures(prisma, userId, flagworthyFailures(err.detail.attempts));
    }
    await recordAiCalls(prisma, calls);
    throw err;
  }

  // Flag only failures needing human action; a transient 429 must not badge a
  // working key as broken. Each row carries its own credentialId, so this never
  // depends on array positions lining up.
  await flagFailures(prisma, userId, flagworthyFailures(result.failures));
  await recordAiCalls(prisma, calls);

  // The winning attempt is the last one logged: `runAttempts` returns as soon as
  // one succeeds, so nothing is pushed after it.
  const won = calls[calls.length - 1];
  const winner = byId.get(result.usedId)!;

  return {
    value: result.value,
    meta: {
      model: won?.model ?? winner.defaultModel,
      provider: winner.provider,
      credentialId: winner.id,
      credentialLabel: winner.label,
      failedAttempts: result.failures.length,
    },
  };
}
