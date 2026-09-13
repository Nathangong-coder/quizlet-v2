import { AbstractionClassificationSchema } from '@/lib/ai/schemas';
import { ABSTRACTION_LEVELS } from '@/lib/klp/abstraction';

export interface ClassifyAbstractionBuildInput {
  question: string;
  klps: { text: string }[];
}

/**
 * Phase A's one model-dependent check: what LEVEL OF ABSTRACTION is each key
 * point pitched at (revision R4)?
 *
 * Everything else in Phase A is deterministic — atomicity, self-containment,
 * meta-language, restatement novelty, numeric consistency — and deliberately
 * so. This one cannot be: telling "the tax shield reduces the after-tax cost of
 * debt" (a relation between two quantities) from "understands why leverage
 * raises beta" (a claim about a person) is a semantic judgment, not a pattern.
 *
 * ## The rule that earns the call
 *
 * **A DISPOSITION IS NEVER A KEY POINT.** It is a claim about a learner, and it
 * cannot be true or false of an ANSWER — so a grader asked whether an answer
 * supports it has nothing to check and will return an impression instead. The
 * key-point set then looks rigorous while measuring the grader's mood. The spec
 * calls this the most useful check in Phase A and that is why.
 *
 * ## Two things this prompt must not do
 *
 * **It must not see `CardKlp.kind`.** `kind` says what TYPE of proposition a
 * point is (`definition | mechanism | causal | ...`); abstraction says how
 * abstract it is. They are different axes, and `mechanism` exists in both
 * vocabularies with different meanings — which is exactly why R4 renamed this
 * one. Showing the model the kind would invite it to answer the wrong question.
 *
 * **It must not compare across cards.** Every judgment is about one point
 * against the question it belongs to. Cards legitimately sit at different
 * specificity — a definitional card and a three-statement walkthrough are not
 * supposed to match — and `findAbstractionDefects` enforces that by only ever
 * looking within one card's set. This prompt never sees a second card.
 *
 * The arithmetic on top of these labels (spread, outliers) is TypeScript. The
 * model classifies; it never decides whether the card has a defect.
 */
export const CLASSIFY_ABSTRACTION_PROMPT = {
  id: 'classify-abstraction',
  version: 1,
  schema: AbstractionClassificationSchema,

  build(input: ClassifyAbstractionBuildInput): string {
    const klps = input.klps.map((k, i) => `[${i}] ${k.text}`).join('\n');

    return `Each statement below is meant to be a PROPOSITION ABOUT THE WORLD that a learner's answer can be checked against. Classify how abstract each one is.

The three levels:

- concrete: a specific fact, quantity, direction, or definition. "Depreciation of 10 reduces pre-tax income by 10." "A deferred tax liability arises from a temporary difference."
- relational: a stated relationship, mechanism, or condition connecting two or more things. "Because interest is tax-deductible, the after-tax cost of debt is lower than its coupon." "Beyond a threshold, the marginal cost of debt exceeds the cost of equity."
- dispositional: a claim about a PERSON's understanding, skill, judgement or awareness rather than about the world. "Understands the trade-off between leverage and risk." "Can reason about capital structure under stress." "Appreciates why the market prices risk."

THE TEST FOR dispositional: could this statement be true or false of an ANSWER, on its own terms? A proposition about the world can. A claim about what someone understands cannot — an answer either states things or it does not, and "understands" is a verdict about the person behind it. If the statement's subject is the learner, the candidate, the student, or their mental state, it is dispositional however much subject matter it mentions.

Judge each statement ALONE, against the question it belongs to. Do not compare the statements to each other, and do not try to make them come out at the same level — a set legitimately mixes levels.

Question: ${input.question}

Statements:
${klps}

Output JSON with exactly one entry per statement, in the order given:
{ "levels": [ { "klpIndex": number, "level": "${ABSTRACTION_LEVELS.join('" | "')}" } ] }`;
  },
};
