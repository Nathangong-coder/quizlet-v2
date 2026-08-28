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

/**
 * How many assets may be copied, regardless of their total size.
 *
 * ADDED after Task 6 pointed out that bytes is not the axis that binds. The
 * copy is one sequential `copy()` round trip per asset, so 100 MB of 100 KB
 * images is ONE THOUSAND network calls inside a single request — and the
 * rollback path then has to `del()` a thousand blobs. There is no `vercel.json`
 * and no `maxDuration` export anywhere in this repo, so that runs at the
 * platform default and simply will not finish.
 *
 * The byte budget alone cannot catch this: a thousand small files are cheap by
 * every measure except the one that actually times out.
 */
export const FORK_MAX_ASSETS = 200

/**
 * What an unreadable `sizeBytes` is counted as.
 *
 * FAILS CLOSED, at the largest per-file cap in `src/actions/uploads.ts` (video,
 * 25 MB) — deliberately NOT zero. `src/lib/sets/visibility.ts` one file over
 * documents fail-closed as the house rule for junk read from the database, and
 * counting a corrupt row as FREE is the one reading that lets it buy budget
 * back for a set that is genuinely too large.
 *
 * Unreachable through the app — `sizeBytes` is a non-nullable `Int` and the
 * only writer is `uploads.ts`, which always writes `file.size` after its own
 * cap check. This is defence against a direct database write, and the reason
 * it is defended in the expensive direction rather than the cheap one.
 */
export const UNKNOWN_ASSET_SIZE_BYTES = 25 * 1024 * 1024

export interface ForkSizeInput {
  cardCount: number
  /**
   * One entry per DISTINCT asset reachable from the set's content blocks.
   *
   * Distinct matters: several blocks may legitimately reference one asset
   * (duplicating a card in the editor does exactly that), and counting an
   * asset once per block would read a 20 MB video reused on six cards as
   * 120 MB and refuse a fork that actually costs 20 MB. The caller dedupes.
   */
  assetSizes: number[]
}

export type ForkSizeVerdict =
  | { ok: true; totalAssetBytes: number }
  | {
      ok: false
      reason: 'too_many_cards' | 'too_many_assets' | 'assets_too_large'
      limit: number
      actual: number
    }

export function checkForkSize({ cardCount, assetSizes }: ForkSizeInput): ForkSizeVerdict {
  // Cards first: it is the cheaper fact and the one a user can most easily act
  // on, so when both gates fail it is the one reported.
  if (cardCount > FORK_MAX_CARDS) {
    return { ok: false, reason: 'too_many_cards', limit: FORK_MAX_CARDS, actual: cardCount }
  }

  // Count before size: it is the gate that actually binds, and a thousand
  // small files pass the byte budget while being the case that cannot finish.
  if (assetSizes.length > FORK_MAX_ASSETS) {
    return {
      ok: false,
      reason: 'too_many_assets',
      limit: FORK_MAX_ASSETS,
      actual: assetSizes.length,
    }
  }

  // An unreadable size counts as the largest thing it could be, not as free.
  // See UNKNOWN_ASSET_SIZE_BYTES.
  const totalAssetBytes = assetSizes.reduce(
    (sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : UNKNOWN_ASSET_SIZE_BYTES),
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
  if (v.reason === 'too_many_assets') {
    return `This set has ${v.actual.toLocaleString('en-US')} attached files, and copies are limited to ${v.limit.toLocaleString('en-US')}.`
  }
  return `This set's media comes to ${mb(v.actual)}, and copies are limited to ${mb(v.limit)}.`
}
