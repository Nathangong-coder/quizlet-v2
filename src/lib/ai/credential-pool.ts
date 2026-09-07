import { selectAttemptOrder, type PoolCredential } from '@/lib/ai/key-pool'

/**
 * Turns credentials into the ordered list of (credential x model) attempts a
 * generation should walk.
 *
 * WHY MODELS ARE PART OF THE UNIT. The Google free-tier cap is
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — per project, per
 * MODEL. Rotating credentials alone therefore buys nothing when both keys sit
 * in one project and default to the same model: measured 2026-09-06, two
 * credentials exhausted seven seconds apart and every retry after that was a
 * guaranteed 429. Spreading across approved models multiplies the daily budget
 * by the number of models; spreading across keys in one project multiplies it
 * by one.
 *
 * This is the same insight `src/lib/klp/direct-pool.ts` already applies to the
 * authoring script, and it calls the same `selectAttemptOrder` rather than
 * growing a second LRU — one ordering rule, two callers.
 *
 * PAID CREDENTIALS ARE NOT FANNED OUT. A billed key has no daily cap to route
 * around, and every extra model is another price to reason about and another
 * quality profile to have verified. A paid credential contributes exactly one
 * attempt, on the model its owner chose.
 */

/** A credential as this module needs to see it. */
export interface PoolInput extends PoolCredential {
  provider: string
  label: string
  /** The model its owner configured. Always the first model tried. */
  defaultModel: string
  /** 'free' | 'paid'. Anything unrecognised is treated as free — the safe side. */
  tier: string
  /**
   * A hard precedence ABOVE the LRU rule: every credential in group 0 is tried
   * before any credential in group 1, whatever their roles or last-used times.
   *
   * It exists for one distinction — a user's own keys (0) before keys borrowed
   * from someone who shared theirs (1). Spending a lender's budget while the
   * borrower's own key sits idle is both surprising and unfair, and LRU alone
   * produces exactly that: a shared key nobody has touched in a week wins on
   * recency against a key its owner just used.
   *
   * Defaults to 0, so a caller that has no such distinction (the authoring
   * script's direct pool) is unaffected.
   */
  group?: number
}

export interface PoolAttempt {
  credentialId: string
  label: string
  provider: string
  model: string
}

/**
 * How many attempts one generation may make.
 *
 * Fanning two credentials across four models is sixteen possible attempts, and
 * a grading call that walks all of them at ~10s each keeps a learner waiting
 * nearly three minutes before failing. The pool exists to survive an exhausted
 * key, not to exhaust the caller's patience: past a handful of failures the
 * honest answer is an error the user can act on.
 */
export const MAX_ATTEMPTS_PER_CALL = 5

/** `${credentialId}:${model}` — the unit a daily quota actually applies to. */
export function comboKey(credentialId: string, model: string): string {
  return `${credentialId}:${model}`
}

/**
 * The ordered attempt list.
 *
 * `extraModels` are the other models this provider is approved for; the
 * caller supplies them so this module stays free of provider policy.
 *
 * `exhausted` is the set of `comboKey`s already known to have returned
 * `quota_exhausted` today. They are dropped rather than sorted last: a combo
 * whose daily cap is gone will fail every time until the cap resets, so trying
 * it is a guaranteed wasted round-trip. Measured cost of not doing this: six
 * questions x two credentials = twelve doomed calls at ~6s each, in one
 * diagnostic submit.
 */
export function buildCredentialPool(input: {
  credentials: PoolInput[]
  /** Approved alternates per provider, excluding each credential's own default. */
  extraModels: (provider: string) => string[]
  exhausted?: ReadonlySet<string>
  limit?: number
}): PoolAttempt[] {
  const exhausted = input.exhausted ?? new Set<string>()
  const limit = input.limit ?? MAX_ATTEMPTS_PER_CALL

  // Credential order first, so the LRU rule still decides who goes before whom
  // — but only WITHIN a group. Sorting the groups separately and concatenating
  // is what makes `group` a precedence rather than a suggestion: one sort over
  // the whole list would let recency reorder across the boundary.
  const groups = [...new Set(input.credentials.map((c) => c.group ?? 0))].sort((a, b) => a - b)
  const ordered = groups.flatMap((group) =>
    selectAttemptOrder(input.credentials.filter((c) => (c.group ?? 0) === group)),
  )

  // Each credential contributes its own default model FIRST, then — only if it
  // is free-tier — the other approved models for its provider. Interleaving by
  // rank (every credential's first choice, then every credential's second)
  // keeps the owner's configured model ahead of a substitute on a sibling key.
  const ranked: PoolAttempt[][] = ordered.map((cred) => {
    const models =
      cred.tier === 'paid'
        ? [cred.defaultModel]
        : [cred.defaultModel, ...input.extraModels(cred.provider).filter((m) => m !== cred.defaultModel)]
    return models.map((model) => ({
      credentialId: cred.id,
      label: cred.label,
      provider: cred.provider,
      model,
    }))
  })

  const out: PoolAttempt[] = []
  const depth = Math.max(0, ...ranked.map((r) => r.length))
  for (let rank = 0; rank < depth; rank++) {
    for (const perCredential of ranked) {
      const attempt = perCredential[rank]
      if (!attempt) continue
      if (exhausted.has(comboKey(attempt.credentialId, attempt.model))) continue
      out.push(attempt)
      if (out.length === limit) return out
    }
  }
  return out
}
