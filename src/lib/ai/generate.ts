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
  execute: (candidate: AttemptCandidate) => Promise<T>,
): Promise<AttemptSuccess<T>> {
  if (candidates.length === 0) {
    throw new AiGenerationError({
      ...describeFailure('no_credentials'),
      attempts: [],
    });
  }

  const failures: AttemptRow[] = [];

  for (const candidate of candidates) {
    try {
      const value = await execute(candidate);
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

export interface GenerateJsonInput<T> {
  userId: string;
  task: AiTask;
  schema: z.ZodSchema<T>;
  prompt?: string;
  parts?: GeminiPart[];
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
    return {
      id: cred.id,
      label: cred.label,
      provider: cred.provider,
      model: overrideModel ?? cred.defaultModel,
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

/**
 * The single generation entry point. Call sites name a task; credential
 * selection, decryption, rotation, and failure aggregation happen here.
 */
export async function generateJson<T>({
  userId, task, schema, prompt, parts,
}: GenerateJsonInput<T>): Promise<T> {
  const { prisma } = await import('@/lib/db');

  const pool = await resolveCandidates(prisma, userId, task);
  const { candidates, byId } = pool;

  // An empty pool has three causes and only one of them is "you have no keys".
  // `runAttempts` cannot tell them apart (it only sees the candidate array),
  // so the distinction is drawn here, where the credential rows are in hand.
  if (candidates.length === 0) {
    throw new AiGenerationError(describeEmptyPool(pool));
  }

  let result: AttemptSuccess<T>;
  try {
    result = await runAttempts(candidates, async (candidate) => {
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

      const { output } = await generateText({
        model,
        output: Output.object({ schema }),
        ...(parts ? { messages: [{ role: 'user' as const, content: toSdkContent(parts) }] } : { prompt: prompt ?? '' }),
      });
      return output as T;
    });
  } catch (err) {
    // Every credential failed, so `runAttempts` threw instead of returning —
    // this is exactly the scenario the settings badge exists for, so it must
    // be flagged here too, not just on the some-succeeded path below.
    if (err instanceof AiGenerationError && err.detail.attempts?.length) {
      await flagFailures(prisma, userId, flagworthyFailures(err.detail.attempts));
    }
    throw err;
  }

  // Flag only failures needing human action; a transient 429 must not badge a
  // working key as broken. Each row carries its own credentialId, so this never
  // depends on array positions lining up.
  await flagFailures(prisma, userId, flagworthyFailures(result.failures));

  return result.value;
}
