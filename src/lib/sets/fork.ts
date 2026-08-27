/**
 * Fork size gates.
 *
 * Forking duplicates every blob (spec §7.2 — sharing an asset row makes
 * `/api/assets/[id]` non-deterministic, because it resolves permission through
 * `contentBlocks[0]` with `take: 1`). That makes forking a genuinely expensive
 * operation, so it needs a bound.
 *
 * Pure and dependency-free, so the arithmetic is tested without a database —
 * the repo convention that the risky arithmetic is always unit-testable. The
 * gates are checked BEFORE any blob copy begins, so a refusal costs nothing.
 */

/** Cards in the source set. */
export const FORK_MAX_CARDS = 1000

/**
 * Summed `CardAsset.sizeBytes` reachable from the set's content blocks.
 *
 * 100 MB, chosen against the per-file caps in `src/actions/uploads.ts`
 * (image 10 / audio 25 / video 25 MB): roughly four videos or ten images,
 * which is a generous real set and a bounded copy.
 */
export const FORK_ASSET_BUDGET_BYTES = 100 * 1024 * 1024

export interface ForkSizeInput {
  cardCount: number
  /** One entry per asset reachable from the set. May contain junk; see below. */
  assetSizes: number[]
}

export type ForkSizeVerdict =
  | { ok: true; totalAssetBytes: number }
  | {
      ok: false
      reason: 'too_many_cards' | 'assets_too_large'
      limit: number
      actual: number
    }

export function checkForkSize({ cardCount, assetSizes }: ForkSizeInput): ForkSizeVerdict {
  // Cards first: it is the cheaper fact and the one a user can most easily act
  // on, so when both gates fail it is the one reported.
  if (cardCount > FORK_MAX_CARDS) {
    return { ok: false, reason: 'too_many_cards', limit: FORK_MAX_CARDS, actual: cardCount }
  }

  // `sizeBytes` arrives from an upload path. A negative or NaN row must not be
  // able to buy budget back for a genuinely oversized set.
  const totalAssetBytes = assetSizes.reduce(
    (sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0),
    0,
  )

  if (totalAssetBytes > FORK_ASSET_BUDGET_BYTES) {
    return {
      ok: false,
      reason: 'assets_too_large',
      limit: FORK_ASSET_BUDGET_BYTES,
      actual: totalAssetBytes,
    }
  }

  return { ok: true, totalAssetBytes }
}

const MB = 1024 * 1024
const mb = (bytes: number) => `${Math.round(bytes / MB)} MB`

/**
 * A refusal that names which gate failed and by how much.
 *
 * "This set is too large" with no number is not actionable, and raw bytes are
 * not a number anybody reads.
 */
export function describeForkRefusal(
  v: Extract<ForkSizeVerdict, { ok: false }>,
): string {
  if (v.reason === 'too_many_cards') {
    return `This set has ${v.actual.toLocaleString('en-US')} cards, and copies are limited to ${v.limit.toLocaleString('en-US')}.`
  }
  return `This set's media comes to ${mb(v.actual)}, and copies are limited to ${mb(v.limit)}.`
}
