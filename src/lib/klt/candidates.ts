import { normalizeKltName } from '@/lib/klt/normalize'

/**
 * How many existing topic names the summarization prompt is shown.
 *
 * The vocabulary is GLOBAL, so it grows without bound across every account and
 * cannot all be sent. This is the retrieval budget.
 */
export const KLT_CANDIDATE_CAP = 150

/**
 * Words shorter than this are too common to be evidence of anything. Without
 * this floor, "the" and "of" in a topic name match nearly every batch and the
 * overlap tier degenerates into "everything".
 */
const MIN_OVERLAP_WORD = 4

export interface KltCandidateInput {
  /** normalizedNames already linked to live KLPs in the same set. */
  setLocal: string[]
  existing: { name: string; normalizedName: string; linkCount: number }[]
  /** The batch's KLP texts, for token-overlap retrieval. */
  klpTexts: string[]
}

/**
 * Build the candidate vocabulary shown to the summarizer, in priority order:
 *
 *   1. set-local — a set is usually one subject, so its own topics are the
 *      strongest prior available;
 *   2. token overlap with the batch text — plain string matching, NO
 *      embeddings (spec §4.3). It will not connect "gearing" to "leverage";
 *      that is accepted for v1, with an operator merge as the remedy;
 *   3. globally most-linked, to fill whatever is left.
 *
 * Truncation happens LAST and in that order, so a popular unrelated topic can
 * never displace a set-local one. Getting that backwards would make the
 * reconciler worse the more the install grows, since the global tail expands
 * without limit while a set's own vocabulary does not.
 */
export function assembleCandidates(input: KltCandidateInput): string[] {
  const byNormalized = new Map(input.existing.map((e) => [e.normalizedName, e]))
  const setLocal = new Set(input.setLocal)

  const tokens = new Set<string>()
  for (const text of input.klpTexts) {
    for (const word of normalizeKltName(text).split(' ')) {
      if (word.length >= MIN_OVERLAP_WORD) tokens.add(word)
    }
  }

  const overlaps = (normalizedName: string): boolean =>
    normalizedName.split(' ').some((w) => w.length >= MIN_OVERLAP_WORD && tokens.has(w))

  const tiers: string[][] = [[], [], []]
  for (const entry of input.existing) {
    const tier = setLocal.has(entry.normalizedName) ? 0 : overlaps(entry.normalizedName) ? 1 : 2
    tiers[tier].push(entry.normalizedName)
  }

  // Only the popularity tail is sorted; the other two keep their natural order.
  tiers[2].sort(
    (a, b) => (byNormalized.get(b)?.linkCount ?? 0) - (byNormalized.get(a)?.linkCount ?? 0),
  )

  const seen = new Set<string>()
  const out: string[] = []
  for (const tier of tiers) {
    for (const normalizedName of tier) {
      if (out.length >= KLT_CANDIDATE_CAP) return out
      if (seen.has(normalizedName)) continue
      seen.add(normalizedName)
      const entry = byNormalized.get(normalizedName)
      if (entry) out.push(entry.name)
    }
  }
  return out
}
