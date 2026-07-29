# Multi-Provider AI Credentials & Explainable Errors — Design

**Date:** 2026-07-27
**Status:** Approved
**Relates to:** Stage 3 (user-supplied keys), Stage 6 (prompting/model routing)

## Problem

Three limits, all rooted in the same assumption — that a user has exactly one
Google key:

1. **One key, one provider.** `AiCredential` is `@@unique([userId])`, so a user
   can save a single Google key and nothing else. There is no way to add a
   second key to spread quota, keep one as backup, or use Anthropic/OpenAI/
   OpenRouter at all.
2. **No model choice.** The model is hardcoded in `src/lib/ai/model-routing.ts`.
   A user cannot pick a model, and when a hardcoded id turns out to be wrong the
   only symptom is a runtime failure mid-quiz.
3. **Errors are unreadable and unexplained.** Failures surface as a truncated
   `toast.error` string. The aggregate AI error reports only the *last* failure,
   which actively hides what went wrong: in the failure that prompted this work,
   two models returned 429 (billing) and three returned 404 (nonexistent model
   ids) — two completely different problems, one of which the user could fix and
   one of which was a bug in the code. The surfaced message mentioned only the
   final 404.

## Approach

### Provider access: Vercel AI SDK v7

One unified interface across Google, Anthropic, OpenAI, OpenRouter, and any
OpenAI-compatible endpoint. Structured output via the SDK replaces the
hand-rolled ```` ```json ```` fence-stripping in `src/lib/ai/google.ts`, closing
the Stage 6 goal of preferring native structured output over regex cleanup.

**API facts verified against the installed package (`ai@7.0.37`), not memory:**

- `generateObject` **no longer exists**. Structured output is
  `generateText({ model, output: Output.object({ schema }) })`, returning
  `{ output }`.
- `createGoogleGenerativeAI` was **renamed to `createGoogle`** in v7.
- `createOpenAICompatible({ name, apiKey, baseURL })` from
  `@ai-sdk/openai-compatible` serves **both** OpenRouter and the generic
  custom-endpoint provider — one adapter covers two features.
- Provider packages (`@ai-sdk/google@4`, `@ai-sdk/anthropic@4`,
  `@ai-sdk/openai@4`, `@ai-sdk/openai-compatible@3`) peer-depend only on
  `zod ^3.25.76 || ^4.1.8`; the project is on `zod ^4.4.3`. Compatible.

Re-verify these before changing provider code. They are the exact class of
detail that was wrong in the bug this work follows.

### Multi-key semantics: least-recently-used rotation

"Run both keys together" means both stay in rotation to spread quota; "backup"
means a key sits out until primaries fail.

Round-robin normally needs a shared counter, which is awkward across serverless
instances. Instead, rotation is **least-recently-used on `lastUsedAt`**: pick the
enabled primary used longest ago. This is naturally fair, survives cold starts,
needs no shared mutable state, and remains a pure function of its inputs.

## Data model

`AiCredential` drops `@@unique([userId])` and becomes many-per-user:

```prisma
model AiCredential {
  id              String    @id @default(cuid())
  userId          String
  provider        String    // google|anthropic|openai|openrouter|custom
  label           String    // user-facing, e.g. "Google (personal)"
  encryptedApiKey String    @db.Text
  keyHint         String
  baseUrl         String?   // openai-compatible + custom only
  defaultModel    String
  role            String    @default("primary")  // primary|backup
  enabled         Boolean   @default(true)
  lastUsedAt      DateTime? // drives LRU rotation
  lastErrorAt     DateTime?
  lastErrorKind   String?   // surfaces a flagged credential in the UI
  verifiedAt      DateTime?
  createdAt, updatedAt
  @@index([userId, provider])
}

model AiTaskRouting {
  id           String  @id @default(cuid())
  userId       String
  task         String  // grade|plan|distractors|autocomplete
  credentialId String?
  model        String?
  @@unique([userId, task])
}
```

Both `credentialId` and `model` are nullable: unset means "fall back to the
provider default", so a partially-configured routing row is meaningful.
`credentialId` is `onDelete: SetNull`, so deleting a credential degrades its
routing rows to the default rather than leaving them pointing at a missing row —
a dangling routing row must never be able to fail a generation.

The migration preserves the existing single Google row. The encryption format is
unchanged (AES-256-GCM, `v1:<iv>:<tag>:<ciphertext>`), so existing ciphertext
still decrypts under the same `GOOGLE_KEY_ENCRYPTION_SECRET`.

## Components

### `src/lib/ai/key-pool.ts` (pure)

`selectAttemptOrder(credentials, now)` → ordered credentials to try:
enabled primaries by oldest `lastUsedAt` first, then enabled backups, with
disabled credentials excluded entirely. The highest-risk logic in this design,
and pure, so it is fully unit-testable without a database.

### `src/lib/ai/providers.ts`

`resolveLanguageModel(credential, modelId)` → an AI SDK `LanguageModel`, mapping
provider string to factory. `custom` and `openrouter` require `baseUrl`;
resolution throws a typed error if it is missing rather than constructing a
half-configured client.

### `src/lib/ai/generate.ts`

`generateJson({ userId, task, prompt | parts, schema })` — the single entry
point, replacing both `generateJsonWithGoogle` and `generateJsonMultimodal`.
Loads credentials, resolves task routing, walks the attempt order, and validates
with the caller's Zod schema. Call sites no longer fetch or decrypt keys; they
name a task.

`src/lib/ai/google.ts` keeps thin re-export shims during the swap so the six
call sites migrate incrementally, and is deleted once everything is green.

### `src/lib/ai/model-catalog.ts`

Per-provider model listing (Google `ListModels`, OpenAI/OpenRouter `/models`,
Anthropic `/v1/models`, custom `{baseUrl}/models`), plus `testCredential`, which
performs a **real one-token generation**.

Listing alone is not sufficient verification and the UI must not imply it is:
`gemini-2.5-flash` appears in Google's `ListModels` yet returns 404 from
`generateContent`. The model picker therefore offers a live list, a free-text
override for unlisted ids, and a Test button that actually generates.

### `src/lib/errors/classify.ts` (pure)

```ts
interface ErrorDetail {
  title: string
  why: string                              // plain English
  fix?: { label: string; href?: string }   // present only when user-fixable
  attribution: 'user' | 'system'
  attempts?: AttemptRow[]
  technical?: string
}
```

| Failure | kind | Attribution | Why |
|---|---|---|---|
| No credential saved | `no_credentials` | user | No AI provider key saved yet |
| 401/403, "API key not valid" | `invalid_key` | user | Provider rejected this key |
| 429 + credits/billing/quota | `quota_exhausted` | user | Prepaid credits used up |
| 429 otherwise | `rate_limited` | user | Too many requests too quickly |
| 404 model | `unknown_model` | user | Model id not served for this key |
| 5xx / network | `provider_down` | **system** | Provider unreachable |
| Zod mismatch | `schema_invalid` | **system** | Model returned unexpected shape |
| anything else | `internal` | **system** | Unexpected error |

`quota_exhausted` and `rate_limited` are deliberately distinct despite both
being HTTP 429. Collapsing them is why the original failure was confusing: one
needs a wallet, the other needs a second key. Likewise the user/system split
answers "is this mine to fix?" directly, so a provider outage does not send the
user hunting through their own configuration.

### Aggregate AI errors

On total failure, the error lists **every** attempt and its classified kind, not
just the last:

```
All 4 attempts failed:
  Google (personal) / gemini-3.6-flash → 429 rate limited
  Google (backup)   / gemini-3.6-flash → 429 rate limited
  OpenRouter        / claude-opus-4    → 401 invalid key
  Anthropic         / claude-bogus     → 404 unknown model
```

Retryable kinds (`rate_limited`, `provider_down`) advance to the next
credential. Fatal-for-this-credential kinds (`invalid_key`, `unknown_model`)
also advance, and additionally stamp `lastErrorKind` so the settings UI can flag
that credential.

### `<ErrorDetailsDialog>` (generic, not AI-specific)

Toasts gain a **Details** action opening a dialog that is full-height on mobile
and a large centered panel on desktop, with the body scrolling internally so
long messages are never truncated. Contents: attribution badge, the "why", the
fix CTA when user-actionable, the per-attempt table when present, and a
collapsible raw-technical block with a Copy button.

`ActionResult` gains an **optional** `detail?: ErrorDetail` beside the existing
`error: string`. All 27 existing `toast.error` call sites keep working
unchanged; AI paths return the richer shape. Converting non-AI call sites is
explicitly out of scope for this pass.

### Settings UI

`/settings/ai` becomes a hub listing every credential grouped by provider, each
row showing label, key hint, model, role, enabled state, and any error flag.
`/settings/ai/[provider]` adds or edits one credential, with the model picker
and Test button. A task-routing panel maps grade/plan/distractors/autocomplete
to a credential + model, defaulting to unset.

## Data flow

```
call site: generateJson({ userId, task, schema, prompt })
  → load credentials + task routing
  → selectAttemptOrder (pure)
  → for each: resolveLanguageModel → generateText + Output.object
      → success: stamp lastUsedAt, return validated object
      → failure: classify, stamp lastErrorKind, continue
  → all failed: aggregate ErrorDetail with every attempt
```

## Testing

- **key-pool:** LRU ordering; backups only after primaries; disabled excluded;
  empty pool; deterministic order when timestamps tie; never-used (`null`
  `lastUsedAt`) sorts before used.
- **classify:** table-driven over **the literal provider strings observed in
  production** — `"Your prepayment credits are depleted"` (429) and
  `"is not found for API version v1beta"` (404) — so the classifier is pinned
  against real output rather than an assumption about it. Plus the user/system
  attribution for each kind.
- **providers:** provider string maps to the right factory; `custom` and
  `openrouter` without `baseUrl` throw rather than silently misconfigure.
- **model-catalog:** response parsing per provider shape.

## Out of scope

- Streaming responses.
- Per-key spend/usage tracking.
- Vercel AI Gateway (conflicts with the bring-your-own-key model).
- Organisation-level or shared credentials.
- Converting the other 26 `toast.error` call sites to `ErrorDetail`.

## Compatibility notes

- `QuizOptionCache` is keyed on model id, so changing the distractor model
  orphans cached options. `gemini-3.1-flash-lite` stays the distractor default
  unless the user overrides it.
- The single multimodal call site (`src/actions/quiz.ts:486`) needs a small
  adapter from the Gemini `inlineData` parts that `src/lib/ai/media.ts` already
  produces to AI SDK content parts. `media.ts` itself is unchanged.
