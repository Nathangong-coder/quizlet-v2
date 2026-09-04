/**
 * Step 7 of the authoring pipeline, mechanically — no AI call.
 *
 * These are the defects a model reliably produces and cannot reliably
 * self-detect, so they are checked with code rather than asked about.
 */
import { MIN_KLPS_PER_CARD, MAX_KLPS_AUTHORED } from '@/lib/klp/authoring-config'

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
 * equipment" must not be flagged, or the author learns to avoid ordinary
 * English. A bare "verb appears on both sides" test is not enough — words
 * like `increases`/`decreases` are also plain nouns, so "both increases and
 * decreases in operating cash flow" false-positives (the "is" on the left
 * side belongs to the sentence's real subject, not to "decreases").
 *
 * A clause needs a SUBJECT before its verb, so a segment is only counted when
 * the verb-like token has at least one token ahead of it within that same
 * "and"-delimited segment. In "EBIT falls ... and net income falls ...", both
 * segments open with a subject ("EBIT", "net income") ahead of "falls". In
 * "... both increases and decreases in operating cash flow", the segment
 * after "and" opens directly on "decreases" — no subject inside that segment
 * at all, because it is the object of "both", not its own clause. This is
 * still a heuristic (a `NP and NP VERB` sentence could evade it), and misses
 * are fine: an undercaught compound KLP is still caught downstream by the
 * discrimination test. A false positive here is not — it trains the author
 * to mangle ordinary English — so this stays deliberately narrow.
 */
const VERBISH = /^(is|are|was|were|falls?|rises?|increases?|decreases?|equals?|has|have|adds?|drops?|becomes?|reduces?|raises?)$/i

function segmentHasSubjectAndVerb(segment: string): boolean {
  const tokens = segment.trim().split(/\s+/).filter(Boolean)
  const verbIndex = tokens.findIndex((t) => VERBISH.test(t.replace(/[^A-Za-z]/g, '')))
  return verbIndex > 0
}

function isCompound(text: string): boolean {
  const parts = text.split(/\band\b/i)
  if (parts.length < 2) return false
  return parts.filter((p) => segmentHasSubjectAndVerb(p)).length >= 2
}

export function validateKlpSet(
  klps: { text: string }[],
  question: string,
): KlpDefect[] {
  const defects: KlpDefect[] = []

  if (klps.length < MIN_KLPS_PER_CARD || klps.length > MAX_KLPS_AUTHORED) {
    defects.push({
      index: null,
      rule: 'count',
      detail: `${klps.length} KLPs; expected ${MIN_KLPS_PER_CARD}-${MAX_KLPS_AUTHORED}`,
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
