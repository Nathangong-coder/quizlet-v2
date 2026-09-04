/**
 * How many KLPs a card should get (increment A §5).
 *
 * The owner asked for "an extra layer of AI that determines how detailed the
 * answer should be" from the question length, the sample answer length, and the
 * detail each point of the sample answer needs, floored at 4. The intent is
 * right; a FIFTH AI CALL is the wrong delivery. The pipeline is already 6-16
 * calls per card, and the pilot proved that volume sits above a free-tier quota
 * for a SINGLE card — a dedicated call whose entire output is one number is the
 * worst cost-to-value ratio available.
 *
 * So the work splits by what actually needs judgment. Lengths and clause counts
 * are free in TypeScript and live here. The per-point detail assessment needs
 * judgment, and the author call is ALREADY reading the definition, so it
 * returns that assessment alongside the reference answer at no extra call.
 *
 *     target = clamp(max(MIN_KLPS_FLOOR, mechanicalPrior, modelAssessment), floor, max)
 *
 * The mechanical prior is a FLOOR-RAISER, never a cap: it is computed before
 * the call and passed into the prompt as "at least this many", and the model's
 * own assessment can raise it further. Neither can lower the other, because
 * both are arguments for MORE detail and neither has grounds to overrule the
 * other downward.
 *
 * WHAT THIS COSTS, stated plainly: a fixed 5-9 range made the count itself a
 * weak quality signal — a card returning 3 was visibly under-authored. An
 * adaptive target removes that signal, so 4 KLPs may now be correctly small or
 * quietly thin. The discrimination test remains the real check; sizing only
 * sets the expectation. Read a low count beside its separation score.
 */
import {
  MIN_KLPS_FLOOR,
  MAX_KLPS_AUTHORED,
  LONG_DEFINITION_CHARS,
  LONG_QUESTION_WORDS,
} from '@/lib/klp/authoring-config'

/**
 * A clause needs this many words to count as a point worth expanding. Below it
 * the segment is a label or punctuation noise — a leading "drivers:", a bare
 * "IRR" — rather than a claim.
 *
 * TWO, not three: a terse definition's bullets are routinely two words ("tax
 * shield", "debt paydown") and those are real points. Three dropped them, which
 * would under-size exactly the terse cards this sizing layer exists for.
 */
const MIN_CLAUSE_WORDS = 2

/**
 * Where one point of a terse definition ends and the next begins.
 *
 * Semicolons, newlines and bullets are unambiguous. A FULL STOP is not: finance
 * definitions are full of "1.5x", "$1,000.00" and "e.g.", and splitting on
 * every period would count a multiple as a separate point. So a period only
 * splits when it follows a word character and is followed by whitespace and a
 * capital (or the end of the string) — sentence punctuation rather than decimal
 * or abbreviation punctuation.
 */
const CLAUSE_SPLIT = /[;\n]+|(?<=[a-z0-9)\]"'])\.(?=\s+[A-Z(]|\s*$)|\s+[-*•]\s+|\s+\d+[.)]\s+/

/**
 * How many distinct points a definition already makes.
 *
 * This is the count of things the reference answer must EXPAND, not a count of
 * KLPs: increment A §2 makes the definition the skeleton, and each point it
 * makes deserves the elaboration a strong spoken answer would give it. One
 * point can still need more than one KLP once expanded, which is what the
 * model's own assessment is for.
 */
export function countDefinitionClauses(definition: string): number {
  return definition
    .split(CLAUSE_SPLIT)
    .filter((segment) => (segment ?? '').trim().split(/\s+/).filter(Boolean).length >= MIN_CLAUSE_WORDS)
    .length
}

/**
 * The sizing inputs that cost nothing: how many points the definition makes,
 * whether it is long enough to be multi-part even when punctuated as one
 * clause, and whether the question itself asks more than one thing.
 *
 * Deliberately NOT floored at `MIN_KLPS_FLOOR` — `targetKlpCount` applies the
 * floor once, and applying it here too would hide a prior of 1 behind a 4 and
 * make an under-informative definition indistinguishable from an average one in
 * any diagnostic that prints the prior.
 */
export function mechanicalKlpPrior(input: { question: string; definition: string }): number {
  const clauses = countDefinitionClauses(input.definition)
  const longDefinition = input.definition.trim().length >= LONG_DEFINITION_CHARS ? 1 : 0
  const questionWords = input.question.trim().split(/\s+/).filter(Boolean).length
  const multiPartQuestion = questionWords >= LONG_QUESTION_WORDS ? 1 : 0

  return Math.min(MAX_KLPS_AUTHORED, clauses + longDefinition + multiPartQuestion)
}

/** One point the definition makes, and how many KLPs it takes once expanded. */
export interface DefinitionPointAssessment {
  point: string
  klpsNeeded: number
}

/**
 * The target, from the mechanical prior and the model's per-point assessment.
 *
 * The model contributes small integers per point, never the total: summing is
 * arithmetic, and arithmetic is TypeScript's job here for the same reason
 * separation and significance are. A model asked directly "how many KLPs does
 * this need" answers with a round number it likes, which is the failure mode
 * that produced 92.3% of weights at 4-5.
 *
 * A missing or empty assessment is not an error — the floor and the prior still
 * produce a usable target, so a model that omits the field degrades the sizing
 * rather than the run.
 */
export function targetKlpCount(input: {
  prior: number
  points?: DefinitionPointAssessment[]
}): number {
  const modelAssessment = (input.points ?? []).reduce(
    (sum, p) => sum + Math.max(0, Math.floor(p.klpsNeeded)),
    0,
  )
  const target = Math.max(MIN_KLPS_FLOOR, input.prior, modelAssessment)
  return Math.min(MAX_KLPS_AUTHORED, Math.max(MIN_KLPS_FLOOR, target))
}
