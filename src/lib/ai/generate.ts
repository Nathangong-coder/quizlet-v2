// NOTE: deliberately no `import 'server-only'` here (unlike src/lib/ai/google.ts).
// The `server-only` package throws unconditionally unless resolved under Next's
// `react-server` export condition; Vitest resolves plain Node conditions, so a
// top-level `import 'server-only'` makes this file's module graph unloadable in
// `tests/ai/generate.test.ts` (which imports this file directly for its pure
// `runAttempts`/`flagworthyFailures` logic). This module is only ever reached via
// server actions ('use server') and other server-only modules, so the guard is
// belt-and-suspenders here, not load-bearing — see task-5-report.md for the
// full tradeoff.
//
// `@/lib/db` is imported lazily (dynamic import) inside `generateJson` rather
// than at module scope, for the same reason and matching the existing pattern
// in src/lib/ai/media.ts (`const { prisma } = await import('@/lib/db')`):
// src/lib/db.ts throws at *import time* if DATABASE_URL is unset, and eagerly
// constructs a real Neon-backed PrismaClient. A top-level import would make
// this file's pure, injected-executor logic (the whole point of `runAttempts`)
// unloadable without a live database configured.
import { generateText, Output } from 'ai';
import { z } from 'zod';
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
 * Retryable kinds are excluded deliberately: a transient 429 clears on its own,
 * and badging a perfectly good key as broken because it was briefly busy would
 * train the user to ignore the badge. Only kinds needing human action
 * (invalid_key, unknown_model, quota_exhausted) persist.
 */
export function flagworthyFailures(failures: AttemptRow[]): AttemptRow[] {
  return failures.filter((f) => !isRetryable(f.kind));
}

export interface GenerateJsonInput<T> {
  userId: string;
  task: AiTask;
  schema: z.ZodSchema<T>;
  prompt?: string;
  parts?: GeminiPart[];
}

/**
 * The single generation entry point. Call sites name a task; credential
 * selection, decryption, rotation, and failure aggregation happen here.
 */
export async function generateJson<T>({
  userId, task, schema, prompt, parts,
}: GenerateJsonInput<T>): Promise<T> {
  const { prisma } = await import('@/lib/db');

  const [credentials, routing] = await Promise.all([
    prisma.aiCredential.findMany({ where: { userId } }),
    prisma.aiTaskRouting.findUnique({ where: { userId_task: { userId, task } } }),
  ]);

  // A routing row pinned to one credential narrows the pool to it; otherwise
  // every credential is eligible. A dangling credentialId is impossible —
  // the FK is ON DELETE SET NULL.
  const eligible = routing?.credentialId
    ? credentials.filter((c) => c.id === routing.credentialId)
    : credentials;

  const ordered = selectAttemptOrder(
    eligible.map((c) => ({
      id: c.id,
      role: c.role === 'backup' ? ('backup' as const) : ('primary' as const),
      enabled: c.enabled,
      lastUsedAt: c.lastUsedAt,
    })),
  );

  const byId = new Map(credentials.map((c) => [c.id, c]));
  const candidates = ordered.map((o) => {
    const cred = byId.get(o.id)!;
    return {
      id: cred.id,
      label: cred.label,
      provider: cred.provider,
      model: routing?.model ?? cred.defaultModel,
    };
  });

  const result = await runAttempts(candidates, async (candidate) => {
    const cred = byId.get(candidate.id)!;
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

  await prisma.aiCredential.update({
    where: { id: result.usedId },
    data: { lastUsedAt: new Date() },
  });

  // Flag only failures needing human action; a transient 429 must not badge a
  // working key as broken. Each row carries its own credentialId, so this never
  // depends on array positions lining up.
  await Promise.all(
    flagworthyFailures(result.failures).map((f) =>
      prisma.aiCredential.updateMany({
        where: { id: f.credentialId, userId },
        data: { lastErrorAt: new Date(), lastErrorKind: f.kind },
      }),
    ),
  );

  return result.value;
}
