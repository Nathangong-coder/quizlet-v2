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

export interface DirectCombo extends PoolCredential {
  /** Index of the key in the configured list — NEVER the key itself. */
  keyIndex: number
  apiKey: string
  model: string
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
export function buildDirectPool(keys: string[], models: string[]): DirectCombo[] {
  const pool: DirectCombo[] = []
  keys.forEach((apiKey, keyIndex) => {
    for (const model of models) {
      pool.push({
        id: `key${keyIndex + 1}:${model}`,
        keyIndex,
        apiKey,
        model,
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
