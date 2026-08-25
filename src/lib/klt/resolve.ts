import { parseKltName } from '@/lib/klt/normalize'
import type { KltSummary } from '@/lib/ai/schemas'

export interface KltWrite {
  klpId: string
  label: string
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
 *   as a cutoff.
 * - A KLP whose topics were all invalid still gets its label. The label is
 *   independently useful, and half a result beats none.
 * - A blank label drops the whole entry: it would render as an empty row.
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

    const label = entry.label.trim().replace(/\s+/g, ' ')
    if (label.length === 0) continue

    const seen = new Set<string>()
    const topics: KltWrite['topics'] = []
    for (const raw of entry.topics) {
      const parsed = parseKltName(raw)
      if (parsed === null) continue
      if (seen.has(parsed.normalizedName)) continue
      seen.add(parsed.normalizedName)
      topics.push({ ...parsed, rank: topics.length + 1 })
    }

    out.push({ klpId, label, topics })
  }

  return out
}
