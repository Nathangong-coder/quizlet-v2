# Multi-Provider AI Credentials & Explainable Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save multiple API keys across Google/Anthropic/OpenAI/OpenRouter/custom providers, rotate between them, pick models per task, and see failures explained in a dialog that says whether the problem is theirs to fix.

**Architecture:** All generation funnels through one `generateJson()` entry point. It resolves which credentials to try via a pure least-recently-used ordering function, resolves each to a Vercel AI SDK `LanguageModel`, and walks the list until one succeeds. Every failure is classified by a pure function into a kind with a user/system attribution, and total failure aggregates *every* attempt rather than only the last.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vercel AI SDK v7 (`ai@7.0.37`), Zod v4, Vitest, Tailwind, sonner.

## Global Constraints

- **AI SDK is v7, not v6.** `generateObject` **does not exist**. Structured output is `generateText({ model, output: Output.object({ schema }) })`, returning `{ output }`.
- **`createGoogleGenerativeAI` was renamed `createGoogle`** in `@ai-sdk/google@4`.
- Provider packages to install: `@ai-sdk/google@^4`, `@ai-sdk/anthropic@^4`, `@ai-sdk/openai@^4`, `@ai-sdk/openai-compatible@^3`. They peer-depend on `zod ^3.25.76 || ^4.1.8`; project is on `zod ^4.4.3`. Compatible — do not upgrade or downgrade zod.
- **Never verify a model by `ListModels` alone.** `gemini-2.5-flash` lists but 404s on generation. Verification means a real generation call.
- Encryption format is unchanged: AES-256-GCM, `v1:<iv>:<tag>:<ciphertext>`, secret `GOOGLE_KEY_ENCRYPTION_SECRET`. Existing ciphertext must keep decrypting.
- `ActionResult<T>` is a discriminated union in `src/types/action.ts`. Only the `success: false` branch gains `detail?: ErrorDetail`; the `error: string` field stays required so all 27 existing `toast.error` call sites keep compiling.
- Tests live in `tests/` mirroring `src/lib/`, run with `npm test` (Vitest, node environment, `@` aliased to `src/`).
- Migrations are hand-written SQL at `prisma/migrations/<UTC timestamp>_<name>/migration.sql`.
- `QuizOptionCache` is keyed on model id. `gemini-3.1-flash-lite` stays the distractor default; do not change it.

---

### Task 1: Error classification (pure)

**Files:**
- Create: `src/lib/errors/classify.ts`
- Test: `tests/errors/classify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ErrorDetail`, `AttemptRow`, `FailureKind`, `FailureAttribution`, `classifyProviderError(err: unknown): FailureKind`, `describeFailure(kind: FailureKind): Pick<ErrorDetail,'title'|'why'|'fix'|'attribution'>`, `isRetryable(kind: FailureKind): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors/classify.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors/classify.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/classify`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/errors/classify.ts

export type FailureAttribution = 'user' | 'system';

export type FailureKind =
  | 'no_credentials'
  | 'invalid_key'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'unknown_model'
  | 'provider_down'
  | 'schema_invalid'
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors/classify.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors/classify.ts tests/errors/classify.test.ts
git commit -m "feat: classify provider errors into explainable kinds"
```

---

### Task 2: Credential rotation ordering (pure)

**Files:**
- Create: `src/lib/ai/key-pool.ts`
- Test: `tests/ai/key-pool.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PoolCredential` (`{ id: string; role: 'primary'|'backup'; enabled: boolean; lastUsedAt: Date | null }`), `selectAttemptOrder<T extends PoolCredential>(credentials: T[]): T[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ai/key-pool.test.ts
import { describe, it, expect } from 'vitest';
import { selectAttemptOrder, type PoolCredential } from '@/lib/ai/key-pool';

const at = (min: number) => new Date(Date.UTC(2026, 6, 27, 12, min));

function cred(over: Partial<PoolCredential> & { id: string }): PoolCredential {
  return { role: 'primary', enabled: true, lastUsedAt: null, ...over };
}

describe('selectAttemptOrder', () => {
  it('orders enabled primaries least-recently-used first', () => {
    const order = selectAttemptOrder([
      cred({ id: 'recent', lastUsedAt: at(30) }),
      cred({ id: 'stale', lastUsedAt: at(5) }),
      cred({ id: 'middle', lastUsedAt: at(15) }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['stale', 'middle', 'recent']);
  });

  it('puts never-used keys before ever-used ones', () => {
    const order = selectAttemptOrder([
      cred({ id: 'used', lastUsedAt: at(1) }),
      cred({ id: 'fresh', lastUsedAt: null }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['fresh', 'used']);
  });

  it('places every backup after every primary regardless of recency', () => {
    const order = selectAttemptOrder([
      cred({ id: 'backup-stale', role: 'backup', lastUsedAt: at(1) }),
      cred({ id: 'primary-recent', role: 'primary', lastUsedAt: at(59) }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['primary-recent', 'backup-stale']);
  });

  it('excludes disabled credentials entirely', () => {
    const order = selectAttemptOrder([
      cred({ id: 'off', enabled: false }),
      cred({ id: 'on' }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['on']);
  });

  it('is deterministic when timestamps tie, falling back to id', () => {
    const input = [
      cred({ id: 'b', lastUsedAt: at(10) }),
      cred({ id: 'a', lastUsedAt: at(10) }),
    ];
    expect(selectAttemptOrder(input).map((c) => c.id)).toEqual(['a', 'b']);
    expect(selectAttemptOrder([...input].reverse()).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const input = [cred({ id: 'b', lastUsedAt: at(20) }), cred({ id: 'a', lastUsedAt: at(1) })];
    const snapshot = input.map((c) => c.id);
    selectAttemptOrder(input);
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });

  it('returns an empty list when nothing is usable', () => {
    expect(selectAttemptOrder([])).toEqual([]);
    expect(selectAttemptOrder([cred({ id: 'off', enabled: false })])).toEqual([]);
  });

  it('alternates keys across successive calls as each is stamped used', () => {
    // Simulates the "run both together" behaviour: after A serves a request
    // and gets stamped, B becomes least-recently-used and serves the next.
    let a = cred({ id: 'A', lastUsedAt: at(0) });
    let b = cred({ id: 'B', lastUsedAt: at(1) });
    const picked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const first = selectAttemptOrder([a, b])[0];
      picked.push(first.id);
      const stamped = { ...first, lastUsedAt: at(10 + i) };
      if (stamped.id === 'A') a = stamped; else b = stamped;
    }
    expect(picked).toEqual(['A', 'B', 'A', 'B']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/key-pool.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/key-pool`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ai/key-pool.ts

/** The minimal credential shape rotation needs. */
export interface PoolCredential {
  id: string;
  role: 'primary' | 'backup';
  enabled: boolean;
  lastUsedAt: Date | null;
}

/**
 * Orders credentials for a generation attempt.
 *
 * Rotation is least-recently-used rather than a counter: a counter cannot be
 * shared across serverless instances, whereas `lastUsedAt` already lives in the
 * database. Stamping a credential after use naturally sends the next request to
 * its sibling, which is what "run both keys together" means in practice.
 *
 * Pure: same input, same output, no mutation of the argument.
 */
export function selectAttemptOrder<T extends PoolCredential>(credentials: T[]): T[] {
  const rank = (c: T) => (c.role === 'backup' ? 1 : 0);
  const used = (c: T) => (c.lastUsedAt === null ? -1 : c.lastUsedAt.getTime());

  return credentials
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (used(a) !== used(b)) return used(a) - used(b);
      return a.id.localeCompare(b.id);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai/key-pool.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/key-pool.ts tests/ai/key-pool.test.ts
git commit -m "feat: least-recently-used credential rotation"
```

---

### Task 3: Schema migration for multi-credential storage

**Files:**
- Modify: `prisma/schema.prisma` (the `AiCredential` model, and `User` relations)
- Create: `prisma/migrations/20260727120000_multi_provider_credentials/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `AiCredential` (many per user, with `provider`, `label`, `baseUrl`, `defaultModel`, `role`, `enabled`, `lastUsedAt`, `lastErrorAt`, `lastErrorKind`) and `AiTaskRouting` (`userId`, `task`, `credentialId`, `model`).

- [ ] **Step 1: Replace the AiCredential model in `prisma/schema.prisma`**

Replace the existing `model AiCredential { ... }` block with:

```prisma
model AiCredential {
  id              String          @id @default(cuid())
  userId          String
  provider        String          @default("google") // google|anthropic|openai|openrouter|custom
  label           String          @default("Default")
  encryptedApiKey String          @db.Text
  keyHint         String
  baseUrl         String?         // required for openrouter + custom
  defaultModel    String          @default("gemini-3.6-flash")
  role            String          @default("primary") // primary|backup
  enabled         Boolean         @default(true)
  lastUsedAt      DateTime?       // drives LRU rotation in lib/ai/key-pool.ts
  lastErrorAt     DateTime?
  lastErrorKind   String?
  verifiedAt      DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  taskRoutings    AiTaskRouting[]

  @@index([userId])
  @@index([userId, provider])
}

model AiTaskRouting {
  id           String        @id @default(cuid())
  userId       String
  task         String        // grade|plan|distractors|autocomplete
  credentialId String?
  model        String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  credential   AiCredential? @relation(fields: [credentialId], references: [id], onDelete: SetNull)

  @@unique([userId, task])
  @@index([userId])
}
```

In `model User`, replace the line `aiCredential     AiCredential?` with:

```prisma
  aiCredentials    AiCredential[]
  aiTaskRoutings   AiTaskRouting[]
```

- [ ] **Step 2: Write the migration SQL**

```sql
-- prisma/migrations/20260727120000_multi_provider_credentials/migration.sql

-- Drop the one-key-per-user constraint; keep the row itself.
DROP INDEX IF EXISTS "AiCredential_userId_key";

-- AlterTable
ALTER TABLE "AiCredential" ADD COLUMN     "label" TEXT NOT NULL DEFAULT 'Default',
ADD COLUMN     "baseUrl" TEXT,
ADD COLUMN     "defaultModel" TEXT NOT NULL DEFAULT 'gemini-3.6-flash',
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'primary',
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorKind" TEXT;

-- Name the pre-existing Google row so it is recognisable in the new list UI.
UPDATE "AiCredential" SET "label" = 'Google (existing)' WHERE "label" = 'Default';

-- CreateIndex
CREATE INDEX "AiCredential_userId_idx" ON "AiCredential"("userId");
CREATE INDEX "AiCredential_userId_provider_idx" ON "AiCredential"("userId", "provider");

-- CreateTable
CREATE TABLE "AiTaskRouting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "credentialId" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskRouting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskRouting_userId_task_key" ON "AiTaskRouting"("userId", "task");
CREATE INDEX "AiTaskRouting_userId_idx" ON "AiTaskRouting"("userId");

-- AddForeignKey
ALTER TABLE "AiTaskRouting" ADD CONSTRAINT "AiTaskRouting_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTaskRouting" ADD CONSTRAINT "AiTaskRouting_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "AiCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the Prisma client and typecheck**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: `prisma generate` succeeds. `tsc` reports errors **only** in `src/actions/ai-settings.ts` (it still calls `findUnique({ where: { userId } })` on a no-longer-unique field). That file is replaced in Task 6 — leave it failing for now.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260727120000_multi_provider_credentials
git commit -m "feat: multi-credential schema with task routing"
```

---

### Task 4: Provider resolution

**Files:**
- Create: `src/lib/ai/providers.ts`
- Test: `tests/ai/providers.test.ts`
- Modify: `package.json` (add provider deps)

**Interfaces:**
- Consumes: `ErrorDetail`/`FailureKind` from Task 1.
- Produces: `AI_PROVIDERS` (readonly list of provider ids), `ProviderId`, `ProviderMeta`, `PROVIDER_META: Record<ProviderId, ProviderMeta>`, `resolveLanguageModel(input: ResolveInput): LanguageModel` where `ResolveInput = { provider: ProviderId; apiKey: string; baseUrl?: string | null; model: string }`, and `ProviderConfigError`.

- [ ] **Step 1: Install the provider packages**

```bash
npm install @ai-sdk/google @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/openai-compatible
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/ai/providers.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolveLanguageModel,
  ProviderConfigError,
  PROVIDER_META,
  AI_PROVIDERS,
} from '@/lib/ai/providers';

describe('PROVIDER_META', () => {
  it('describes every supported provider', () => {
    for (const id of AI_PROVIDERS) {
      const meta = PROVIDER_META[id];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.requiresBaseUrl).toBe('boolean');
      expect(meta.defaultModel.length).toBeGreaterThan(0);
    }
  });

  it('requires a base URL only for the openai-compatible providers', () => {
    expect(PROVIDER_META.google.requiresBaseUrl).toBe(false);
    expect(PROVIDER_META.anthropic.requiresBaseUrl).toBe(false);
    expect(PROVIDER_META.openai.requiresBaseUrl).toBe(false);
    expect(PROVIDER_META.openrouter.requiresBaseUrl).toBe(true);
    expect(PROVIDER_META.custom.requiresBaseUrl).toBe(true);
  });

  it('defaults the distractor-safe Google model, since QuizOptionCache is keyed on model id', () => {
    expect(PROVIDER_META.google.defaultModel).toBe('gemini-3.6-flash');
  });
});

describe('resolveLanguageModel', () => {
  it('builds a model for each first-party provider', () => {
    for (const provider of ['google', 'anthropic', 'openai'] as const) {
      const model = resolveLanguageModel({ provider, apiKey: 'k', model: 'some-model' });
      expect(model).toBeDefined();
    }
  });

  it('builds a model for openai-compatible providers given a base URL', () => {
    const model = resolveLanguageModel({
      provider: 'openrouter',
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4',
    });
    expect(model).toBeDefined();
  });

  it('throws rather than building a half-configured client when baseUrl is missing', () => {
    // Silently defaulting the URL would send the key to the wrong host.
    expect(() => resolveLanguageModel({ provider: 'custom', apiKey: 'k', model: 'm' }))
      .toThrow(ProviderConfigError);
    expect(() => resolveLanguageModel({ provider: 'openrouter', apiKey: 'k', baseUrl: '  ', model: 'm' }))
      .toThrow(ProviderConfigError);
  });

  it('throws on an unknown provider id', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid
      resolveLanguageModel({ provider: 'nope', apiKey: 'k', model: 'm' }),
    ).toThrow(ProviderConfigError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/ai/providers.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/providers`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/lib/ai/providers.ts
import { createGoogle } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const AI_PROVIDERS = ['google', 'anthropic', 'openai', 'openrouter', 'custom'] as const;
export type ProviderId = (typeof AI_PROVIDERS)[number];

export interface ProviderMeta {
  label: string;
  /** OpenAI-compatible providers have no fixed host, so a base URL is mandatory. */
  requiresBaseUrl: boolean;
  defaultModel: string;
  defaultBaseUrl?: string;
  /** Endpoint used to list models; see lib/ai/model-catalog.ts. */
  keyPlaceholder: string;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  google: {
    label: 'Google Gemini',
    requiresBaseUrl: false,
    defaultModel: 'gemini-3.6-flash',
    keyPlaceholder: 'AIza…',
  },
  anthropic: {
    label: 'Anthropic Claude',
    requiresBaseUrl: false,
    defaultModel: 'claude-sonnet-4-5',
    keyPlaceholder: 'sk-ant-…',
  },
  openai: {
    label: 'OpenAI',
    requiresBaseUrl: false,
    defaultModel: 'gpt-5',
    keyPlaceholder: 'sk-…',
  },
  openrouter: {
    label: 'OpenRouter',
    requiresBaseUrl: true,
    defaultModel: 'anthropic/claude-sonnet-4.5',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'sk-or-…',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    requiresBaseUrl: true,
    defaultModel: '',
    keyPlaceholder: 'your API key',
  },
};

/** Thrown when a credential cannot produce a usable client. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export interface ResolveInput {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string | null;
  model: string;
}

/**
 * Builds an AI SDK LanguageModel for one credential.
 *
 * NOTE: `createGoogle` is the v7 name — it was `createGoogleGenerativeAI`
 * before the rename. Do not "fix" it back.
 */
export function resolveLanguageModel({ provider, apiKey, baseUrl, model }: ResolveInput): LanguageModel {
  switch (provider) {
    case 'google':
      return createGoogle({ apiKey })(model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'openrouter':
    case 'custom': {
      const url = baseUrl?.trim();
      if (!url) {
        throw new ProviderConfigError(
          `${PROVIDER_META[provider].label} needs a base URL. Add one in AI settings.`,
        );
      }
      return createOpenAICompatible({ name: provider, apiKey, baseURL: url })(model);
    }
    default:
      throw new ProviderConfigError(`Unknown AI provider: ${String(provider)}`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ai/providers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/ai/providers.ts tests/ai/providers.test.ts
git commit -m "feat: resolve credentials to AI SDK language models"
```

---

### Task 5: Unified generation entry point

**Files:**
- Create: `src/lib/security/api-key.ts` (moved here from Task 6 so this task compiles standalone)
- Modify: `src/lib/security/google-key.ts` (reduce to re-exports)
- Create: `src/lib/ai/generate.ts`
- Create: `src/lib/ai/media-adapter.ts`
- Test: `tests/ai/generate.test.ts`

**Interfaces:**
- Consumes: `selectAttemptOrder`/`PoolCredential` (Task 2), `resolveLanguageModel`/`ProviderConfigError` (Task 4), `classifyProviderError`/`describeFailure`/`isRetryable`/`ErrorDetail`/`AttemptRow` (Task 1).
- Produces: `encryptApiKey`/`decryptApiKey`/`maskApiKey`; `AiGenerationError` (carries `.detail: ErrorDetail`), `runAttempts<T>(...)` (injected executor for testability), `flagworthyFailures`, `toSdkContent(parts)`.

- [ ] **Step 0: Generalise the key crypto (moved from Task 6)**

Create `src/lib/security/api-key.ts` containing the exact body of the existing `src/lib/security/google-key.ts`, with these changes only:
- Rename `encryptGoogleApiKey` → `encryptApiKey`, `decryptGoogleApiKey` → `decryptApiKey`, `maskGoogleApiKey` → `maskApiKey`.
- Keep the env var `GOOGLE_KEY_ENCRYPTION_SECRET` and the `v1:` payload format **unchanged**, so existing ciphertext still decrypts.
- `maskApiKey` must not assume an `AIza` prefix: return `key.slice(0, 4) + '****' + key.slice(-4)` when `key.length > 8`, else `key.slice(0, 2) + '***' + key.slice(-2)`.

Then reduce `src/lib/security/google-key.ts` to re-exports so existing importers keep working until Task 8 deletes it:

```ts
export {
  encryptApiKey as encryptGoogleApiKey,
  decryptApiKey as decryptGoogleApiKey,
  maskApiKey as maskGoogleApiKey,
} from './api-key';
```

Verify the existing crypto tests still pass: `npx vitest run tests/ai/google-key.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ai/generate.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/generate.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/generate`.

- [ ] **Step 3: Write the orchestrator**

```ts
// src/lib/ai/generate.ts
import {
  classifyProviderError,
  describeFailure,
  isRetryable,
  type AttemptRow,
  type ErrorDetail,
  type FailureKind,
} from '@/lib/errors/classify';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai/generate.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Add the database-facing wrapper and media adapter**

```ts
// src/lib/ai/media-adapter.ts
/**
 * Converts the Gemini-shaped parts that src/lib/ai/media.ts already produces
 * into AI SDK message content. media.ts is deliberately left unchanged.
 */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type SdkContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: string; mediaType: string };

export function toSdkContent(parts: GeminiPart[]): SdkContentPart[] {
  return parts.map((part) =>
    'text' in part
      ? { type: 'text' as const, text: part.text }
      : { type: 'file' as const, data: part.inlineData.data, mediaType: part.inlineData.mimeType },
  );
}
```

Append to `src/lib/ai/generate.ts`:

```ts
import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { decryptApiKey } from '@/lib/security/api-key';
import { selectAttemptOrder } from '@/lib/ai/key-pool';
import { resolveLanguageModel, type ProviderId } from '@/lib/ai/providers';
import { toSdkContent, type GeminiPart } from '@/lib/ai/media-adapter';
// AiTask is declared once, in model-routing.ts (it already exports it today).
// Do not re-declare it here — two definitions would drift.
import type { AiTask } from '@/lib/ai/model-routing';

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
```

- [ ] **Step 6: Verify the suite and typecheck still pass**

Run: `npx vitest run tests/ai/ && npx tsc --noEmit`
Expected: Vitest PASS. `tsc` still reports errors only in `src/actions/ai-settings.ts` (replaced in Task 6) and any file importing `decryptApiKey` before Task 6 renames it — if `src/lib/security/api-key.ts` does not exist yet, do Task 6 Step 1 first.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/generate.ts src/lib/ai/media-adapter.ts tests/ai/generate.test.ts
git commit -m "feat: unified multi-credential generation entry point"
```

---

### Task 6: Credential server actions and model catalog

**Files:**
- Create: `src/lib/security/api-key.ts` (generalised from `google-key.ts`)
- Create: `src/lib/ai/model-catalog.ts`
- Create: `src/actions/ai-credentials.ts`
- Delete: `src/actions/ai-settings.ts`
- Modify: `src/types/action.ts`
- Test: `tests/ai/model-catalog.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_META`/`ProviderId`/`resolveLanguageModel` (Task 4), `ErrorDetail` (Task 1).
- Produces: `encryptApiKey`/`decryptApiKey`/`maskApiKey`; `parseModelList(provider, json): string[]`; actions `listCredentials`, `saveCredential`, `deleteCredential`, `testCredential`, `listProviderModels`, `saveTaskRouting`, `listTaskRoutings`.

- [ ] **Step 1: (moved) — the key crypto now lands in Task 5 Step 0**

`src/lib/security/api-key.ts` and the `google-key.ts` re-export shim are created
in Task 5 Step 0, because Task 5's `generate.ts` imports `decryptApiKey` and
must compile standalone. Verify both exist before continuing; if they do not,
implement Task 5 Step 0 first.

- [ ] **Step 2: Extend ActionResult**

```ts
// src/types/action.ts
import type { ErrorDetail } from '@/lib/errors/classify';

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; detail?: ErrorDetail };
```

- [ ] **Step 3: Write the failing model-catalog test**

```ts
// tests/ai/model-catalog.test.ts
import { describe, it, expect } from 'vitest';
import { parseModelList } from '@/lib/ai/model-catalog';

describe('parseModelList', () => {
  it('reads Google ListModels and keeps only generateContent-capable ids', () => {
    const json = {
      models: [
        { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    };
    expect(parseModelList('google', json)).toEqual(['gemini-3.6-flash']);
  });

  it('reads the OpenAI/OpenRouter data array', () => {
    const json = { data: [{ id: 'gpt-5' }, { id: 'o4-mini' }] };
    expect(parseModelList('openai', json)).toEqual(['gpt-5', 'o4-mini']);
    expect(parseModelList('openrouter', json)).toEqual(['gpt-5', 'o4-mini']);
  });

  it('reads the Anthropic data array', () => {
    expect(parseModelList('anthropic', { data: [{ id: 'claude-sonnet-4-5' }] }))
      .toEqual(['claude-sonnet-4-5']);
  });

  it('returns an empty list for an unrecognised payload rather than throwing', () => {
    // A custom endpoint may not implement /models at all; the picker must
    // degrade to free-text entry instead of erroring.
    expect(parseModelList('custom', { unexpected: true })).toEqual([]);
    expect(parseModelList('custom', null)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/ai/model-catalog.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/model-catalog`.

- [ ] **Step 5: Implement the model catalog**

```ts
// src/lib/ai/model-catalog.ts
import 'server-only';
import type { ProviderId } from '@/lib/ai/providers';

/**
 * Parses a provider's model-list payload into plain ids.
 *
 * Returns [] on anything unrecognised: a custom OpenAI-compatible endpoint may
 * not implement /models, and the picker must fall back to free-text entry
 * rather than surfacing an error.
 */
export function parseModelList(provider: ProviderId, json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const body = json as Record<string, unknown>;

  if (provider === 'google') {
    const models = Array.isArray(body.models) ? body.models : [];
    return models
      .filter((m): m is { name: string; supportedGenerationMethods?: string[] } =>
        !!m && typeof (m as { name?: unknown }).name === 'string')
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  }

  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .filter((m): m is { id: string } => !!m && typeof (m as { id?: unknown }).id === 'string')
    .map((m) => m.id);
}

const LIST_ENDPOINTS: Record<ProviderId, (key: string, baseUrl?: string | null) => { url: string; headers: Record<string, string> }> = {
  google: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`,
    headers: {},
  }),
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models?limit=100',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
  openai: (key) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  openrouter: (key, baseUrl) => ({
    url: `${(baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/models`,
    headers: { Authorization: `Bearer ${key}` },
  }),
  custom: (key, baseUrl) => ({
    url: `${(baseUrl ?? '').replace(/\/$/, '')}/models`,
    headers: { Authorization: `Bearer ${key}` },
  }),
};

export async function fetchModelList(
  provider: ProviderId, apiKey: string, baseUrl?: string | null,
): Promise<string[]> {
  const { url, headers } = LIST_ENDPOINTS[provider](apiKey, baseUrl);
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  return parseModelList(provider, await res.json());
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/ai/model-catalog.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the credential actions**

Create `src/actions/ai-credentials.ts` with `'use server'` and these exports. Every action starts with the `auth()` guard used throughout `src/actions/`, and every credential lookup is scoped by `userId` so one user can never touch another's row.

```ts
'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { generateText } from 'ai';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/security/api-key';
import { AI_PROVIDERS, PROVIDER_META, resolveLanguageModel, type ProviderId } from '@/lib/ai/providers';
import { fetchModelList } from '@/lib/ai/model-catalog';
import { classifyProviderError, describeFailure } from '@/lib/errors/classify';
import type { ActionResult } from '@/types/action';

const CredentialInput = z.object({
  id: z.string().optional(),
  provider: z.enum(AI_PROVIDERS),
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(8).optional(), // omitted when editing without rotating the key
  baseUrl: z.string().trim().url().optional().or(z.literal('')),
  defaultModel: z.string().trim().min(1).max(120),
  role: z.enum(['primary', 'backup']),
  enabled: z.boolean(),
});

export interface CredentialRow {
  id: string; provider: string; label: string; keyHint: string;
  baseUrl: string | null; defaultModel: string; role: string; enabled: boolean;
  verifiedAt: string | null; lastUsedAt: string | null; lastErrorKind: string | null;
}

/** Every lookup is scoped by userId so one user can never reach another's row. */
async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function listCredentials(): Promise<ActionResult<CredentialRow[]>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    const rows = await prisma.aiCredential.findMany({
      where: { userId },
      orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id, provider: r.provider, label: r.label, keyHint: r.keyHint,
        baseUrl: r.baseUrl, defaultModel: r.defaultModel, role: r.role, enabled: r.enabled,
        verifiedAt: r.verifiedAt?.toISOString() ?? null,
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        lastErrorKind: r.lastErrorKind,
      })),
    };
  } catch (error) {
    console.error('List credentials error:', error);
    return { success: false, error: 'Failed to load credentials' };
  }
}

export async function saveCredential(
  input: z.infer<typeof CredentialInput>,
): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const parsed = CredentialInput.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid credential details' };
  const v = parsed.data;

  const baseUrl = v.baseUrl?.trim() || PROVIDER_META[v.provider].defaultBaseUrl || null;
  if (PROVIDER_META[v.provider].requiresBaseUrl && !baseUrl) {
    return { success: false, error: `${PROVIDER_META[v.provider].label} requires a base URL.` };
  }

  try {
    if (v.id) {
      // Editing. Only re-encrypt when a new key was actually supplied, so
      // saving other fields does not require re-entering the key.
      const existing = await prisma.aiCredential.findFirst({
        where: { id: v.id, userId }, select: { id: true },
      });
      if (!existing) return { success: false, error: 'Credential not found' };

      await prisma.aiCredential.update({
        where: { id: v.id },
        data: {
          label: v.label, baseUrl, defaultModel: v.defaultModel,
          role: v.role, enabled: v.enabled,
          ...(v.apiKey
            ? {
                encryptedApiKey: encryptApiKey(v.apiKey),
                keyHint: maskApiKey(v.apiKey),
                verifiedAt: null, lastErrorAt: null, lastErrorKind: null,
              }
            : {}),
        },
      });
      revalidatePath('/settings/ai');
      return { success: true, data: { id: v.id } };
    }

    if (!v.apiKey) return { success: false, error: 'An API key is required.' };

    const created = await prisma.aiCredential.create({
      data: {
        userId, provider: v.provider, label: v.label,
        encryptedApiKey: encryptApiKey(v.apiKey), keyHint: maskApiKey(v.apiKey),
        baseUrl, defaultModel: v.defaultModel, role: v.role, enabled: v.enabled,
      },
      select: { id: true },
    });
    revalidatePath('/settings/ai');
    return { success: true, data: { id: created.id } };
  } catch (error) {
    console.error('Save credential error:', error);
    return { success: false, error: 'Failed to save credential' };
  }
}

export async function deleteCredential(id: string): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    // deleteMany (not delete) so a wrong-owner id is a no-op, never a 500.
    await prisma.aiCredential.deleteMany({ where: { id, userId } });
    revalidatePath('/settings/ai');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('Delete credential error:', error);
    return { success: false, error: 'Failed to delete credential' };
  }
}

export async function listProviderModels(id: string): Promise<ActionResult<string[]>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    const cred = await prisma.aiCredential.findFirst({ where: { id, userId } });
    if (!cred) return { success: false, error: 'Credential not found' };
    const models = await fetchModelList(
      cred.provider as ProviderId, decryptApiKey(cred.encryptedApiKey), cred.baseUrl,
    );
    return { success: true, data: models };
  } catch (error) {
    console.error('List provider models error:', error);
    return { success: false, error: 'Failed to list models' };
  }
}

/**
 * Verifies a credential with a REAL generation call.
 *
 * A listing call is not sufficient: gemini-2.5-flash appears in Google's
 * ListModels yet returns 404 from generateContent, so listing would pass a
 * model that cannot actually serve a request.
 */
export async function testCredential(id: string, model?: string): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const cred = await prisma.aiCredential.findFirst({ where: { id, userId } });
  if (!cred) return { success: false, error: 'Credential not found' };

  try {
    await generateText({
      model: resolveLanguageModel({
        provider: cred.provider as ProviderId,
        apiKey: decryptApiKey(cred.encryptedApiKey),
        baseUrl: cred.baseUrl,
        model: model?.trim() || cred.defaultModel,
      }),
      prompt: 'Reply with the single word: ok',
    });

    await prisma.aiCredential.update({
      where: { id: cred.id },
      data: { verifiedAt: new Date(), lastErrorAt: null, lastErrorKind: null },
    });
    revalidatePath('/settings/ai');
    return { success: true, data: undefined };
  } catch (err) {
    const kind = classifyProviderError(err);
    const described = describeFailure(kind);
    await prisma.aiCredential.update({
      where: { id: cred.id },
      data: { verifiedAt: null, lastErrorAt: new Date(), lastErrorKind: kind },
    });
    revalidatePath('/settings/ai');
    return {
      success: false,
      error: described.title,
      detail: { ...described, technical: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function listTaskRoutings(): Promise<
  ActionResult<{ task: string; credentialId: string | null; model: string | null }[]>
> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    const rows = await prisma.aiTaskRouting.findMany({ where: { userId } });
    return {
      success: true,
      data: rows.map((r) => ({ task: r.task, credentialId: r.credentialId, model: r.model })),
    };
  } catch (error) {
    console.error('List task routings error:', error);
    return { success: false, error: 'Failed to load task routing' };
  }
}

export async function saveTaskRouting(
  task: string, credentialId: string | null, model: string | null,
): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const TaskName = z.enum(['grade', 'plan', 'distractors', 'autocomplete']);
  const parsedTask = TaskName.safeParse(task);
  if (!parsedTask.success) return { success: false, error: 'Unknown task' };

  try {
    // Guard cross-user assignment: the credential must belong to this user.
    if (credentialId) {
      const owned = await prisma.aiCredential.findFirst({
        where: { id: credentialId, userId }, select: { id: true },
      });
      if (!owned) return { success: false, error: 'Credential not found' };
    }

    await prisma.aiTaskRouting.upsert({
      where: { userId_task: { userId, task: parsedTask.data } },
      update: { credentialId, model: model?.trim() || null },
      create: { userId, task: parsedTask.data, credentialId, model: model?.trim() || null },
    });
    revalidatePath('/settings/ai');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('Save task routing error:', error);
    return { success: false, error: 'Failed to save task routing' };
  }
}
```

- [ ] **Step 8: Delete the superseded action file and verify**

```bash
git rm src/actions/ai-settings.ts
npx tsc --noEmit
```
Expected: errors now only in `src/app/settings/ai/page.tsx` (rewritten in Task 7) and the six `src/lib/ai/google.ts` call sites (rewired in Task 8).

- [ ] **Step 9: Commit**

```bash
git add -A src/lib/security src/lib/ai/model-catalog.ts src/actions/ai-credentials.ts src/types/action.ts tests/ai/model-catalog.test.ts
git commit -m "feat: credential CRUD, model catalog, and live key testing"
```

---

### Task 7: Error dialog and settings UI

**Files:**
- Create: `src/components/errors/ErrorDetailsDialog.tsx`
- Create: `src/components/errors/useErrorToast.tsx`
- Create: `src/components/settings/CredentialList.tsx`
- Create: `src/components/settings/CredentialForm.tsx`
- Create: `src/components/settings/TaskRoutingPanel.tsx`
- Rewrite: `src/app/settings/ai/page.tsx`
- Create: `src/app/settings/ai/[provider]/page.tsx`
- Delete: `src/components/settings/GoogleApiKeyForm.tsx`

**Why the delete:** `GoogleApiKeyForm.tsx` is the single-Google-key form, imported
only by `src/app/settings/ai/page.tsx`. Once that page is rewritten it is
orphaned, and it still imports the deleted `src/actions/ai-settings.ts`, so
leaving it in place keeps `npx tsc --noEmit` permanently broken. Its
functionality is wholly replaced by `CredentialForm.tsx`.

**Interfaces:**
- Consumes: `ErrorDetail`/`AttemptRow` (Task 1), `PROVIDER_META`/`AI_PROVIDERS` (Task 4), all actions from Task 6.
- Produces: `<ErrorDetailsDialog detail open onOpenChange />`, `useErrorToast()` returning `(error: string, detail?: ErrorDetail) => void`.

- [ ] **Step 1: Build the dialog**

`ErrorDetailsDialog` renders, using the existing `src/components/ui/dialog.tsx`:
- The `title`, and a badge reading **"You can fix this"** when `attribution === 'user'` or **"Problem on our end"** when `'system'`.
- The `why` paragraph.
- The `fix` CTA as a `Link` to `fix.href` when present.
- An `attempts` table (label, provider, model, kind) when present.
- A collapsible `technical` block in a `<pre>` with a Copy button.

Sizing requirement — the reason this exists is that toast text gets cut off, so the dialog must never truncate:

```tsx
<DialogContent className="max-w-2xl w-full h-dvh sm:h-auto sm:max-h-[85vh] flex flex-col">
  <DialogHeader>{/* title + badge */}</DialogHeader>
  <div className="flex-1 overflow-y-auto space-y-4 pr-1">
    {/* why, fix, attempts table, technical <pre className="whitespace-pre-wrap break-words"> */}
  </div>
</DialogContent>
```

- [ ] **Step 2: Build the toast hook**

```tsx
// src/components/errors/useErrorToast.tsx
'use client';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { ErrorDetail } from '@/lib/errors/classify';
import ErrorDetailsDialog from './ErrorDetailsDialog';

export function useErrorToast() {
  const [detail, setDetail] = useState<ErrorDetail | null>(null);

  const show = useCallback((error: string, d?: ErrorDetail) => {
    if (!d) { toast.error(error); return; }
    toast.error(d.title, {
      description: d.why,
      action: { label: 'Details', onClick: () => setDetail(d) },
    });
  }, []);

  const dialog = (
    <ErrorDetailsDialog detail={detail} open={detail !== null} onOpenChange={(o) => !o && setDetail(null)} />
  );

  return { show, dialog };
}
```

- [ ] **Step 3: Build the settings hub**

`src/app/settings/ai/page.tsx` lists credentials grouped by provider via `listCredentials()`, each row showing label, `keyHint`, `defaultModel`, role, enabled toggle, a `lastErrorKind` warning badge, and Test / Edit / Delete. Add-buttons link to `/settings/ai/<provider>` for each entry in `AI_PROVIDERS`. Below the list, render `<TaskRoutingPanel />` mapping each of `grade | plan | distractors | autocomplete` to a credential + model, defaulting to "Use provider default".

- [ ] **Step 4: Build the per-provider form**

`src/app/settings/ai/[provider]/page.tsx` validates the route param against `AI_PROVIDERS` (calling `notFound()` otherwise) and renders `<CredentialForm provider={provider} />` with: label, API key (password input, placeholder from `PROVIDER_META[provider].keyPlaceholder`), base URL (shown and required only when `PROVIDER_META[provider].requiresBaseUrl`, prefilled with `defaultBaseUrl`), a model `<select>` populated by `listProviderModels` plus a free-text override, role radio (primary/backup), enabled checkbox, and Save / Test buttons.

The model field must carry this note, because listing is not proof of usability:

> Listed models are not guaranteed to work with your key. Press Test to confirm.

- [ ] **Step 5: Verify build and typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean, except for the six `google.ts` call sites still pending in Task 8 if they have not been rewired yet.

- [ ] **Step 6: Commit**

```bash
git add src/components/errors src/components/settings src/app/settings/ai
git commit -m "feat: multi-provider AI settings UI and full-screen error dialog"
```

---

### Task 8: Rewire call sites and retire google.ts

**Files:**
- Modify: `src/actions/quiz.ts` (6 generation call sites, incl. multimodal at ~line 486)
- Modify: `src/actions/training-plan.ts:46`, `src/actions/card-autocomplete.ts:46`
- Modify: `src/app/sets/[id]/print/page.tsx:62`
- Modify: `src/app/sets/[id]/quiz/page.tsx:24`
- Delete: `src/lib/ai/google.ts`, `src/lib/security/google-key.ts`
- Modify: `src/lib/ai/model-routing.ts`

**Interfaces:**
- Consumes: `generateJson` (Task 5), `AiGenerationError` (Task 5).
- Produces: `AiTask` (unchanged, still from `model-routing.ts`) and
  `TASK_DEFAULT_MODEL`; `modelFor`/`MODEL_FALLBACKS` are removed.

- [ ] **Step 1: Replace each call site**

Each site currently decrypts a key and calls `generateJsonWithGoogle`. Replace that whole block. Before:

```ts
const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);
const grade = await generateJsonWithGoogle({
  apiKey, prompt, schema: ShortAnswerGradeSchema, model: modelFor('grade'),
});
```

After:

```ts
const grade = await generateJson({
  userId: session.user.id, task: 'grade', prompt, schema: ShortAnswerGradeSchema,
});
```

For the multimodal site in `src/actions/quiz.ts` (~line 486), pass `parts` instead of `prompt`; `src/lib/ai/media.ts` is unchanged and its output feeds straight in.

Delete the now-unused `credential` lookups and `decryptGoogleApiKey` imports at each site.

- [ ] **Step 2: Surface rich errors at the action boundary**

Wherever an action catches a generation failure, return the detail:

```ts
} catch (err) {
  if (err instanceof AiGenerationError) {
    return { success: false, error: err.detail.title, detail: err.detail };
  }
  console.error('Quiz generation error:', err);
  return { success: false, error: 'Failed to generate quiz' };
}
```

- [ ] **Step 3: Reduce model-routing.ts to task defaults**

`MODEL_FALLBACKS` and `modelFor` are superseded by credentials and `AiTaskRouting`. Keep only the per-task default model used when a provider has no explicit routing:

```ts
// src/lib/ai/model-routing.ts
export type AiTask = 'grade' | 'plan' | 'autocomplete' | 'distractors';

/**
 * Fallback model per task when no AiTaskRouting row exists. Credential
 * `defaultModel` takes precedence; this is the last resort.
 *
 * distractors/autocomplete stay on gemini-3.1-flash-lite because
 * QuizOptionCache is keyed on model id — changing it orphans every cached
 * distractor set.
 */
export const TASK_DEFAULT_MODEL: Record<AiTask, string> = {
  grade: 'gemini-3.6-flash',
  plan: 'gemini-3.6-flash',
  distractors: 'gemini-3.1-flash-lite',
  autocomplete: 'gemini-3.1-flash-lite',
};
```

Delete `tests/ai/model-routing.test.ts` and replace it with a test asserting `TASK_DEFAULT_MODEL.distractors === 'gemini-3.1-flash-lite'` (the cache-key invariant) and that every `AiTask` has an entry.

- [ ] **Step 2b: Fix the quiz page's credential gate**

`src/app/sets/[id]/quiz/page.tsx:24` gates the quiz UI on whether the user has
a credential, using `findUnique({ where: { userId } })`. That no longer
compiles once `userId` stops being unique, and its copy names Google
specifically, which is wrong now that four providers are supported.

Replace the lookup with a presence check for any *usable* credential:

```ts
// Any enabled credential is enough to offer AI quizzing; which provider it
// is gets decided per-task at generation time.
const credential = await prisma.aiCredential.findFirst({
  where: { userId: session.user.id, enabled: true },
  select: { id: true },
});
```

And make the empty-state copy provider-neutral:

```tsx
<p>You need an AI provider API key to access AI quizzing.</p>
```

Note the `enabled: true` filter: a user who has disabled every credential has
none available, and should see the same prompt as a user with none saved.

- [ ] **Step 3b: Fix the print page's cache lookup**

`src/app/sets/[id]/print/page.tsx:62` currently reads cached options with
`where: { cardId: { in: ... }, model: modelFor('distractors') }`. That filter
assumed a single global distractor model. Now that each user picks their own,
a fixed model id would silently match nothing and the page would render as if
no options had ever been generated.

Drop the `model` filter and take the most recent cache row per card instead:

```ts
const caches = await prisma.quizOptionCache.findMany({
  where: { cardId: { in: cards.map((c) => c.id) } },
  orderBy: { updatedAt: 'desc' },
});
// First row per cardId wins, since the list is newest-first.
const optionsByCard = new Map<string, unknown>();
for (const row of caches) {
  if (!optionsByCard.has(row.cardId)) optionsByCard.set(row.cardId, row.options);
}
```

Remove the now-unused `modelFor` import from this file.

- [ ] **Step 4: Delete the superseded modules**

```bash
git rm src/lib/ai/google.ts src/lib/security/google-key.ts
```

- [ ] **Step 5: Full verification**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all tests pass, typecheck clean, build succeeds. Confirm `stripMarkdownJson` no longer exists anywhere: `grep -rn "stripMarkdownJson" src` returns nothing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: route all AI generation through the credential pool"
```

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.env.example`

- [ ] **Step 1: Update CLAUDE.md**

In the "AI integration" section, replace the single-key description with: credentials are many-per-user in `AiCredential` (provider, label, model, role, enabled), rotation is least-recently-used via `lastUsedAt` in `src/lib/ai/key-pool.ts`, all generation goes through `generateJson()` in `src/lib/ai/generate.ts` on AI SDK v7, and failures are classified by `src/lib/errors/classify.ts` into a kind with a user/system attribution. Note that `generateObject` does not exist in v7 and that `createGoogle` is the current Google factory name.

- [ ] **Step 2: Note the unchanged env contract in .env.example**

Add a comment above `GOOGLE_KEY_ENCRYPTION_SECRET` recording that it now encrypts keys for every provider, not just Google, and that the variable name is retained deliberately so existing ciphertext keeps decrypting.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: describe multi-provider credential architecture"
```
