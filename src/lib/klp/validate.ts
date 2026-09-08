/**
 * Step 7 of the authoring pipeline, mechanically — no AI call.
 *
 * These are the defects a model reliably produces and cannot reliably
 * self-detect, so they are checked with code rather than asked about.
 */
import { MIN_KLPS_PER_CARD, MAX_KLPS_AUTHORED } from '@/lib/klp/authoring-config'
import type { RelationEdge } from '@/lib/klp/relations'
import { findNumericDefects } from '@/lib/klp/numeric'
import { findAbstractionDefects, type AbstractionLevel } from '@/lib/klp/abstraction'

export interface KlpDefect {
  /** The offending KLP, or null for a whole-set defect. */
  index: number | null
  rule:
    | 'compound'
    | 'restatement'
    | 'count'
    | 'duplicate'
    | 'ordering'
    // Phase A (the quality-pipeline spec). Deterministic, no AI call.
    | 'not_self_contained'
    | 'meta_language'
    | 'numeric_inconsistency'
    | 'disposition'
    | 'abstraction_spread'
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

/**
 * KLPs stored out of the order a strong answer delivers them (increment A §3).
 *
 * `CardKlp.index` used to be array position and carry no meaning. It now means
 * delivery order — setup, then mechanism, then payoff — and half of that claim
 * is mechanically checkable with machinery already built: order-violation
 * extraction produces `precedes` edges, meaning the later point CONSUMES the
 * earlier one's output. A `precedes` edge pointing backwards against the stored
 * index order is a genuine contradiction between two things the same run
 * produced, and it costs no AI call to find.
 *
 * THE LIMIT, kept deliberately: `precedes` covers only consumption order. It
 * says nothing about the setup/payoff framing — whether the final KLP actually
 * lands the answer to the question asked — which stays a prompt instruction and
 * is not mechanically enforceable. This check catches contradictions, not
 * blandness, and reading a clean result as "the ordering is good" over-reads it.
 *
 * Only `precedes` is used. `requires` and `causes` are dependency claims, not
 * delivery-order claims: a strong answer may legitimately state a conclusion
 * before the mechanism that produces it, so flagging those would manufacture
 * defects out of good answers.
 */
export function findOrderingDefects(edges: RelationEdge[]): KlpDefect[] {
  return edges
    .filter((e) => e.type === 'precedes' && e.from > e.to)
    .map((e) => ({
      index: e.from,
      rule: 'ordering' as const,
      detail: `KLP ${e.from} must precede KLP ${e.to}, but is stored after it`,
    }))
}

/**
 * A key point that cannot be read on its own.
 *
 * Phase A puts self-containment FIRST for a reason the spec states plainly:
 * local defects break every downstream check. Ask a verifier whether "it also
 * reduces taxable income" is true and the answer is meaningless — "it" is
 * unresolvable outside the list, so the verifier silently invents a referent
 * and grades against that. The KLP then LOOKS verified.
 *
 * Two shapes, both cheap:
 *  - a leading pronoun with no antecedent inside the key point itself
 *  - an explicit cross-reference ("as mentioned above", "the previous point")
 *
 * Deliberately only a LEADING pronoun. A mid-sentence "it" usually has its
 * antecedent in the same sentence ("depreciation rises, and it reduces taxable
 * income"), and flagging those would train the author out of ordinary English —
 * the same trap `isCompound` documents.
 */
const LEADING_PRONOUN = /^(it|its|this|that|these|those|they|them|their|he|she|his|her)\b/i
const CROSS_REFERENCE =
  /\b(as (mentioned|noted|described|stated|discussed) (above|earlier|previously)|the (previous|preceding|prior|next|following) (point|klp|item)|see above|as above)\b/i

function selfContainmentDefect(text: string): string | null {
  const trimmed = text.trim()
  if (CROSS_REFERENCE.test(trimmed)) {
    return 'refers to another point — a key point is graded alone and cannot resolve the reference'
  }
  if (LEADING_PRONOUN.test(trimmed)) {
    const word = trimmed.split(/\s+/)[0]
    return `opens with "${word}", which has no antecedent inside this point — name the subject`
  }
  return null
}

/**
 * META-LANGUAGE: a sentence about what a STUDENT should do, rather than a
 * proposition about the world.
 *
 * "The student should mention the tax shield" cannot be true or false of the
 * world, so a grader asked whether an answer supports it is really being asked
 * whether the answer pleases an assessor. That is the same failure the
 * `dispositional` abstraction level names, arriving through wording rather than
 * through concept — and it is worth catching here because it costs no model
 * call and is trivially fixable by rewriting to the underlying claim.
 */
const META_LANGUAGE =
  /\b(the (student|learner|candidate|answer|response)\s+(should|must|needs? to|ought to|is expected to)|should (mention|state|note|say|discuss|explain|include|identify)|candidates? (should|must)|a good answer)\b/i

/**
 * A key point that says nothing the question did not already say.
 *
 * The spec calls this "n-gram overlap with the question stem". Overlap alone
 * is the wrong direction to measure: a good key point about "how does
 * depreciation affect the three statements" SHOULD share most of its
 * vocabulary with that question, and a long stem shares n-grams with anything
 * related to it. Overlap would flag the best-anchored points hardest.
 *
 * What "restatement" actually means is that the point adds no INFORMATION — so
 * the measure is novelty on the key point's side: of its content words, how
 * many are absent from the question? A point that merely rearranges the stem
 * scores near zero and is a restatement; one that names a mechanism, a
 * direction, or a number scores well above the floor however much vocabulary it
 * shares.
 *
 * Content words only. Without stopword removal, "the/of/is/to" alone carries a
 * short point over any threshold.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from', 'how', 'in',
  'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what',
  'when', 'which', 'why', 'with', 'you', 'your',
])

/**
 * Below this fraction of novel content words, a key point is a restatement.
 *
 * 0.3 means "at least three in ten of its content words are not in the
 * question". Low on purpose: the cost of a false positive is rejecting a
 * correctly-anchored point, and a genuine restatement scores far below this —
 * typically 0 to 0.1, because it is the stem with the words moved.
 */
export const RESTATEMENT_NOVELTY_FLOOR = 0.3

function contentWords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
}

/** Fraction of the key point's content words absent from the question. */
export function noveltyAgainstQuestion(klpText: string, question: string): number {
  const words = contentWords(klpText)
  if (words.length === 0) return 0
  const stem = new Set(contentWords(question))
  return words.filter((w) => !stem.has(w)).length / words.length
}

export interface ValidateOptions {
  /**
   * The accepted relation edges, for the ordering cross-check. Omitted means
   * "no graph to check against", not "the order is fine".
   */
  edges?: RelationEdge[]
  /**
   * The card's adaptive KLP target (`src/lib/klp/sizing.ts`). Defaults to
   * `MIN_KLPS_PER_CARD` so a caller with no sizing information still gets the
   * floor rather than no check at all.
   */
  targetCount?: number
  /**
   * Per-KLP abstraction levels, in KLP order (R4).
   *
   * OPTIONAL, and its absence means "not classified", never "all concrete".
   * Classification needs a model; every other rule in this file is
   * deterministic, and a caller with no AI budget must still get all of them
   * rather than none. Supplying a partial array checks only what was supplied.
   */
  abstraction?: (AbstractionLevel | undefined)[]
}

export function validateKlpSet(
  klps: { text: string }[],
  question: string,
  options: ValidateOptions = {},
): KlpDefect[] {
  const defects: KlpDefect[] = []
  const target = Math.max(MIN_KLPS_PER_CARD, options.targetCount ?? MIN_KLPS_PER_CARD)

  if (klps.length < target || klps.length > MAX_KLPS_AUTHORED) {
    defects.push({
      index: null,
      rule: 'count',
      detail: `${klps.length} KLPs; expected ${target}-${MAX_KLPS_AUTHORED}`,
    })
  }

  const q = normalize(question)
  const seen = new Map<string, number>()

  klps.forEach((klp, index) => {
    if (isCompound(klp.text)) {
      defects.push({ index, rule: 'compound', detail: 'two claims joined by "and" — split it' })
    }
    const containment = selfContainmentDefect(klp.text)
    if (containment) {
      defects.push({ index, rule: 'not_self_contained', detail: containment })
    }
    if (META_LANGUAGE.test(klp.text)) {
      defects.push({
        index,
        rule: 'meta_language',
        detail:
          'describes what a student should say rather than stating a fact about the world — ' +
          'rewrite it as the underlying claim',
      })
    }
    const n = normalize(klp.text)
    if (n === q) {
      defects.push({ index, rule: 'restatement', detail: 'restates the question' })
    } else if (noveltyAgainstQuestion(klp.text, question) < RESTATEMENT_NOVELTY_FLOOR) {
      // Not identical, but adds almost nothing the question did not already
      // say. Exact-match alone missed every reworded restatement, which is the
      // form a model actually produces.
      defects.push({
        index,
        rule: 'restatement',
        detail:
          `only ${(noveltyAgainstQuestion(klp.text, question) * 100).toFixed(0)}% of its content ` +
          `words are absent from the question — it rephrases the stem rather than answering it`,
      })
    }
    const first = seen.get(n)
    if (first !== undefined) {
      defects.push({ index, rule: 'duplicate', detail: `same proposition as KLP ${first}` })
    } else {
      seen.set(n, index)
    }
  })

  defects.push(...findOrderingDefects(options.edges ?? []))

  // R6 — arithmetic, with no model in the loop, because a model that got it
  // wrong while authoring will confirm it while verifying.
  for (const d of findNumericDefects(klps)) {
    defects.push({ index: d.index, rule: 'numeric_inconsistency', detail: d.detail })
  }

  // R4 — abstraction, WITHIN this card only. Skipped entirely when nothing
  // classified the points, rather than assuming a level.
  if (options.abstraction && options.abstraction.length > 0) {
    for (const d of findAbstractionDefects(options.abstraction)) {
      defects.push({ index: d.index, rule: d.rule, detail: d.detail })
    }
  }

  return defects
}
