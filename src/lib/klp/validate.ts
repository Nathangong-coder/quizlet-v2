/**
 * Step 7 of the authoring pipeline, mechanically — no AI call.
 *
 * These are the defects a model reliably produces and cannot reliably
 * self-detect, so they are checked with code rather than asked about.
 */
import { MIN_KLPS_PER_CARD } from '@/lib/klp/authoring-config'
import { MAX_KLPS_PER_CARD } from '@/lib/ai/schemas'

export interface KlpDefect {
  /** The offending KLP, or null for a whole-set defect. */
  index: number | null
  rule: 'compound' | 'restatement' | 'count' | 'duplicate'
  detail: string
}

/** Cheap normalisation for comparing two propositions. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * A COMPOUND KLP is one that could half-fail — two independent claims joined
 * so a learner can get one right and one wrong, leaving the verdict
 * meaningless.
 *
 * The test is "and" joining two CLAUSES, not two nouns: "property, plant and
 * equipment" is one noun phrase and must not be flagged, or the author learns
 * to avoid ordinary English. A clause is approximated by a verb appearing on
 * both sides, which is crude but errs toward silence.
 */
const VERBISH = /\b(is|are|was|were|falls?|rises?|increases?|decreases?|equals?|has|have|adds?|drops?|becomes?|reduces?|raises?)\b/

function isCompound(text: string): boolean {
  const parts = text.split(/\band\b/i)
  if (parts.length < 2) return false
  return parts.filter((p) => VERBISH.test(p)).length >= 2
}

export function validateKlpSet(
  klps: { text: string }[],
  question: string,
): KlpDefect[] {
  const defects: KlpDefect[] = []

  if (klps.length < MIN_KLPS_PER_CARD || klps.length > MAX_KLPS_PER_CARD) {
    defects.push({
      index: null,
      rule: 'count',
      detail: `${klps.length} KLPs; expected ${MIN_KLPS_PER_CARD}-${MAX_KLPS_PER_CARD}`,
    })
  }

  const q = normalize(question)
  const seen = new Map<string, number>()

  klps.forEach((klp, index) => {
    if (isCompound(klp.text)) {
      defects.push({ index, rule: 'compound', detail: 'two claims joined by "and" — split it' })
    }
    const n = normalize(klp.text)
    if (n === q) {
      defects.push({ index, rule: 'restatement', detail: 'restates the question' })
    }
    const first = seen.get(n)
    if (first !== undefined) {
      defects.push({ index, rule: 'duplicate', detail: `same proposition as KLP ${first}` })
    } else {
      seen.set(n, index)
    }
  })

  return defects
}
