/**
 * Rotation for the `--direct` authoring path: many raw keys, many models.
 *
 * The website already rotates credentials — `selectAttemptOrder`
 * (`src/lib/ai/key-pool.ts`) over `AiCredential` rows — but the pilot script
 * cannot use it. `--direct` exists precisely because stored credentials are
 * encrypted with `GOOGLE_KEY_ENCRYPTION_SECRET`, which the local `.env` does
 * not carry, so every decrypt throws. This module gives the script the same
 * BEHAVIOUR without the database, and it does so by CALLING the same pure
 * ordering function rather than reimplementing it — a second LRU
 * implementation would be a second thing to keep correct.
 *
 * THE UNIT OF ROTATION IS (KEY x MODEL), not the key.
 * Measured 2026-09-04: the free-tier cap is
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — 20 requests per day,
 * scoped per model per project. So one key exhausted on `gemini-3.5-flash`
 * still has a full bucket on `gemini-3.1-flash-lite`, and rotating keys alone
 * would leave most of the available budget untouched.
 *
 * THE UNIT OF PINNING IS THE CARD, not the call. Every combo is held fixed for
 * a whole card, because a card's discrimination test grades a reference answer
 * and three adversaries and then SUBTRACTS their scores. Grading those four
 * candidates with different models would put the difference between two graders
 * inside the separation score, where it is indistinguishable from the
 * difference between a strong and a weak answer — quietly destroying the one
 * number the pipeline exists to compute. Rotating between cards costs nothing
 * of the sort; rotating within one would invalidate it.
 */
import { selectAttemptOrder, type PoolCredential } from '@/lib/ai/key-pool'
import type { ProviderId } from '@/lib/ai/providers'

export interface DirectCombo extends PoolCredential {
  /** Index of the key in the configured list — NEVER the key itself. */
  keyIndex: number
  apiKey: string
  model: string
  /**
   * Which provider these keys belong to. One pool is one provider: a key is
   * only meaningful to the API it was issued by, so mixing providers in a
   * single pool would produce combos that can never authenticate.
   *
   * It exists so `--direct` can measure a NON-Google provider on exactly the
   * path Google runs on. Comparing authoring quality across providers is only
   * meaningful if the prompts, pacing, pinning and separation arithmetic are
   * identical, and the surest way to keep them identical is to not have a
   * second code path.
   */
  provider: string
  /**
   * Base URL for providers that resolve through the SDK's OpenAI-compatible
   * path (`custom`). Undefined for first-class providers, which know their
   * own endpoint. Qwen/DashScope is the first source that needs it.
   */
  baseUrl?: string
  /** See `ResolveInput.requestDefaults`. Set by a source, never by a flag. */
  requestDefaults?: Record<string, unknown>
}

/** Splits a comma/whitespace separated env value, dropping blanks and dupes. */
export function parseList(value: string | undefined): string[] {
  if (!value) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value.split(/[,\s]+/)) {
    const item = raw.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/**
 * The cross product of keys and models, every entry starting unused.
 *
 * All entries are `primary`: `selectAttemptOrder` puts primaries first and then
 * orders by least-recently-tried, so a flat pool spreads evenly, which is what
 * a pilot wants. The role field exists because the shared ordering function
 * takes it, not because this pool has a hierarchy.
 *
 * `id` is `key<n>:<model>` — the INDEX, never the secret. These ids are printed
 * on every card so a run can be traced afterwards, and a printed key would end
 * up in scrollback, logs, and anywhere that output is pasted.
 */
export function buildDirectPool(
  keys: string[],
  models: string[],
  provider = 'google',
  baseUrl?: string,
  requestDefaults?: Record<string, unknown>,
): DirectCombo[] {
  const pool: DirectCombo[] = []
  keys.forEach((apiKey, keyIndex) => {
    for (const model of models) {
      pool.push({
        id: `key${keyIndex + 1}:${model}`,
        keyIndex,
        apiKey,
        model,
        provider,
        ...(baseUrl ? { baseUrl } : {}),
        ...(requestDefaults ? { requestDefaults } : {}),
        role: 'primary',
        enabled: true,
        lastUsedAt: null,
      })
    }
  })
  return pool
}

/** The next combo to try, or undefined when every one is exhausted. */
export function nextCombo(pool: DirectCombo[]): DirectCombo | undefined {
  return selectAttemptOrder(pool)[0]
}

/**
 * Stamped BEFORE the attempt, not after success — the same rule
 * `generateJson` follows for `lastUsedAt`, and for the same reason: it means
 * "least recently tried". Stamping on success would make a failing combo look
 * permanently fresh and get it picked again immediately.
 */
export function markTried(combo: DirectCombo, now: Date): void {
  combo.lastUsedAt = now
}

/**
 * Retires a combo for the REST OF THE RUN.
 *
 * Called when the provider names a per-day quota for it. That is not a reason
 * to stop — it is a reason to stop using THIS pair, which is the whole point of
 * having a pool. The run halts only when `nextCombo` comes back empty.
 */
export function markExhausted(combo: DirectCombo): void {
  combo.enabled = false
}

export interface PoolStatus {
  total: number
  available: number
  exhausted: number
  /** Model ids still usable on at least one key. */
  modelsLeft: string[]
}

export function poolStatus(pool: DirectCombo[]): PoolStatus {
  const available = pool.filter((c) => c.enabled)
  return {
    total: pool.length,
    available: available.length,
    exhausted: pool.length - available.length,
    modelsLeft: Array.from(new Set(available.map((c) => c.model))),
  }
}

/**
 * The per-provider defaults `readDirectPool` builds from.
 *
 * Exported so a test can assert the table rather than duplicating it, and so
 * the error message for an unsupported provider can name the real options.
 */
export const DIRECT_PROVIDER_SOURCES: Record<
  string,
  {
    keyVars: string[]
    defaultModel: string
    /**
     * The `ProviderId` `resolveLanguageModel` is called with. Defaults to the
     * source name. A source whose provider is not first-class in the app
     * (Qwen) resolves as `custom` and must carry a `baseUrl`.
     */
    resolveAs?: string
    baseUrl?: string
    /** Read from the environment at pool-build time; see the qwen entry. */
    requestDefaults?: (env: NodeJS.ProcessEnv) => Record<string, unknown> | undefined
  }
> = {
  google: { keyVars: ['GOOGLE_API_KEYS', 'GOOGLE_API_KEY'], defaultModel: 'gemini-3.6-flash' },
  deepseek: { keyVars: ['DEEPSEEK_API_KEYS', 'DEEPSEEK_API_KEY'], defaultModel: 'deepseek-v4-flash' },
  /**
   * Qwen via DashScope's OpenAI-compatible endpoint (international region —
   * the mainland host rejects this key with 401). Entitlement went live
   * 2026-09-11; before that every model returned 403 `AccessDenied.Unpurchased`
   * (see `docs/ai/model-performance.md`).
   *
   * Only the 3.7 family holds the structured-output contract here: DashScope
   * downgrades a `json_schema` request to `json_object` for `qwen3.6-flash` and
   * `qwen3.6-plus`, so nothing constrains the shape and Zod rejects the reply
   * every time. Measured 2026-09-11. Do not put a 3.6 model in this pool.
   */
  qwen: {
    keyVars: ['QWENCLOUD_API_KEYS', 'QWENCLOUD_API_KEY'],
    defaultModel: 'qwen3.7-flash',
    resolveAs: 'custom',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    /**
     * `QWEN_THINKING=off` sends DashScope's `enable_thinking: false`.
     * qwen3.8-flash thinks by default: 274 s and 12,588 reasoning tokens on
     * the shortest minting card, and a headers timeout on the longer ones;
     * the same call with thinking off took 7 s (2026-09-12). Off by request
     * rather than always, so runs measured with thinking on stay comparable.
     */
    requestDefaults: (env) => (env.QWEN_THINKING?.toLowerCase() === 'off' ? { enable_thinking: false } : undefined),
  },
}

/**
 * Reads the `--direct` pool from the environment.
 *
 * LIVES HERE rather than in a script because more than one operator tool needs
 * it — `npm run author-klps` and `npm run klp-exploit` — and a second copy of
 * the provider table is a second thing to keep correct. The first thing it
 * would drift on is which provider's keys are being spent, which is exactly
 * the log line that makes a billing surprise take an hour to trace.
 *
 * `KLP_DIRECT_PROVIDER` selects the provider and defaults to google, so every
 * existing `.env` and documented command keeps working unchanged.
 *
 * Keys are read from the environment ONLY — never a flag, because argv is
 * visible to every other process on the machine and lands in shell history.
 */
export function readDirectPool(
  env: NodeJS.ProcessEnv = process.env,
  /**
   * Which env vars to read. `attack` is the historical pair
   * (`KLP_DIRECT_PROVIDER` / `KLP_DIRECT_MODELS`), so every existing command
   * keeps working unchanged.
   *
   * `verify` reads `KLP_VERIFIER_PROVIDER` / `KLP_VERIFIER_MODELS` and exists
   * for ROLE SEPARATION: the model that writes an adversarial answer must not
   * be the model that then rules on whether the attack succeeded. See
   * `scripts/klp-exploit.ts`.
   */
  role: 'attack' | 'verify' = 'attack',
): DirectCombo[] {
  const providerVar = role === 'verify' ? 'KLP_VERIFIER_PROVIDER' : 'KLP_DIRECT_PROVIDER'
  const modelsVar = role === 'verify' ? 'KLP_VERIFIER_MODELS' : 'KLP_DIRECT_MODELS'
  const provider = (env[providerVar] ?? env.KLP_DIRECT_PROVIDER ?? 'google').trim().toLowerCase()

  const source = DIRECT_PROVIDER_SOURCES[provider]
  if (!source) {
    throw new Error(
      `${providerVar}=${provider} is not supported — use one of: ` +
        `${Object.keys(DIRECT_PROVIDER_SOURCES).join(', ')}`,
    )
  }

  const keys = [...new Set(source.keyVars.flatMap((v) => parseList(env[v])))]
  if (keys.length === 0) {
    throw new Error(
      `--direct with ${providerVar}=${provider} needs one of ` +
        `${source.keyVars.join(' or ')} in the environment`,
    )
  }

  const models = parseList(env[modelsVar] ?? (role === 'attack' ? env.KLP_DIRECT_MODEL : undefined))
  return buildDirectPool(
    keys,
    models.length > 0 ? models : [source.defaultModel],
    source.resolveAs ?? provider,
    source.baseUrl,
    source.requestDefaults?.(env),
  )
}

/**
 * The `resolveLanguageModel` input for one combo.
 *
 * Every operator script used to spell `{ provider, apiKey, model }` out by
 * hand, which is how a new field on the combo (`baseUrl`) would silently reach
 * none of them — each caller would compile, and each would send a `custom`
 * provider with no URL and fail at request time.
 */
export function comboResolveInput(combo: DirectCombo): {
  provider: ProviderId
  apiKey: string
  model: string
  baseUrl?: string
  requestDefaults?: Record<string, unknown>
} {
  return {
    provider: combo.provider as ProviderId,
    apiKey: combo.apiKey,
    model: combo.model,
    ...(combo.baseUrl ? { baseUrl: combo.baseUrl } : {}),
    ...(combo.requestDefaults ? { requestDefaults: combo.requestDefaults } : {}),
  }
}
