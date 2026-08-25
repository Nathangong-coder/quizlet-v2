/**
 * A KLT is a CONCEPT NAME, not a proposition — "WACC", not "WACC weights each
 * capital source by market value". These caps are what keep it that way: the
 * model is asked for a short topic, and anything longer is DROPPED rather than
 * trimmed, because a truncated concept name is a different concept.
 *
 * The caps are also the containment for spec §9.2. The vocabulary is global
 * and is fed into other users' summarization prompts, so a four-word ceiling
 * forces names toward general concepts and away from anything that could carry
 * content specific to one private set.
 */
export const MAX_KLT_WORDS = 4
export const MAX_KLT_CHARS = 40

/**
 * The dedup key.
 *
 * `Klt.normalizedName` is GLOBALLY unique, so this function alone decides
 * whether two accounts' topics are the same node. Golden-vector tested for
 * that reason: changing it does not migrate anything, it strands every row
 * already written under the old spelling and silently splits one topic in two.
 *
 * Hyphens survive (`after-tax` is one word); every other punctuation mark
 * becomes a space, which is then collapsed.
 */
export function normalizeKltName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Validate and split a model-supplied topic into its display and key forms.
 *
 * Returns null for anything invalid. Callers DROP a null; they never repair
 * it. Fabricating or truncating a topic to fill a slot is the KLT analogue of
 * Spec 2a's rule that degradation never invents a tag — once written, a bad
 * topic is indistinguishable from a good one, and it will move mastery.
 *
 * Both caps are measured against the NORMALIZED form so that surrounding
 * whitespace or punctuation cannot push an otherwise valid name over.
 */
export function parseKltName(raw: string): { name: string; normalizedName: string } | null {
  const normalizedName = normalizeKltName(raw)
  if (normalizedName.length === 0) return null
  if (normalizedName.length > MAX_KLT_CHARS) return null
  if (normalizedName.split(' ').length > MAX_KLT_WORDS) return null
  return { name: raw.trim().replace(/\s+/g, ' '), normalizedName }
}
