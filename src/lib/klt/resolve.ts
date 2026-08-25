import { parseKltName, parseKltLabel } from '@/lib/klt/normalize'
import type { KltSummary } from '@/lib/ai/schemas'

export interface KltWrite {
  klpId: string
  /** Null when the model's label was unusable — callers fall back to `text`. */
  label: string | null
  topics: { name: string; normalizedName: string; rank: number }[]
}

/**
 * Turn one summarization reply into the exact rows to write.
 *
 * Every "the model returned junk" rule lives here and nowhere else, so all of
 * them are testable without a database or an AI call. The rules:
 *
 * - A ref outside the batch is DROPPED. Writing it onto whatever KLP happens
 *   to occupy that position would attach one point's topics to another's —
 *   the same hazard `extractOneBatch` guards with its `if (!card) continue`.
 * - A repeated ref keeps only the first entry.
 * - An invalid topic name is DROPPED and the survivors RE-RANKED, so ranks are
 *   always contiguous from 1. A gap would make rank mean two different things
 *   depending on what the model returned, and `masteryTopicRanks` reads rank
 *   as a cutoff. Re-ranking is right even though rank is a BREADTH TIER: if the
 *   model's narrow rung was unusable, the next one up becomes the narrowest
 *   this KLP actually has, and pretending otherwise would leave a topic the
 *   mastery cutoff silently skips.
 * - A KLP whose topics were all invalid still gets its label, and a KLP whose
 *   LABEL was unusable still gets its topics. The two grains fail
 *   independently, and half a result beats none.
 * - An over-long label is DROPPED to null, never truncated — see
 *   `parseKltLabel`. This is the guard that stops the whole layer quietly
 *   doing nothing when a model echoes the proposition back as its "label".
 * - A blank label no longer drops the entry: the topics may still be good.
 *
 * Nothing here ever REPAIRS a bad value. A truncated or invented topic is
 * indistinguishable downstream from a real one and would move mastery — the
 * same reason Spec 2a's degradation never fabricates a tag.
 */
export function resolveKltWrites(entries: KltSummary['klps'], klpIds: string[]): KltWrite[] {
  const out: KltWrite[] = []
  const usedRefs = new Set<number>()

  for (const entry of entries) {
    const klpId = klpIds[entry.ref]
    if (klpId === undefined) continue
    if (usedRefs.has(entry.ref)) continue
    usedRefs.add(entry.ref)

    const label = parseKltLabel(entry.label)

    const seen = new Set<string>()
    const topics: KltWrite['topics'] = []
    for (const raw of entry.topics) {
      const parsed = parseKltName(raw)
      if (parsed === null) continue
      if (seen.has(parsed.normalizedName)) continue
      seen.add(parsed.normalizedName)
      topics.push({ ...parsed, rank: topics.length + 1 })
    }

    // Nothing usable at either grain — writing a row would only cost an
    // UPDATE that sets label back to the null it already is.
    if (label === null && topics.length === 0) continue

    out.push({ klpId, label, topics })
  }

  return out
}
