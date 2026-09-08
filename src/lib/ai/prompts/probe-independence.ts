import { IndependenceProbeSchema } from '@/lib/ai/schemas';

export interface ProbeIndependenceBuildInput {
  question: string;
  textA: string;
  textB: string;
}

/**
 * C3's confirming call: can an answer hold one of these two propositions
 * without the other?
 *
 * Reached only for pairs the free shortlist proposed — two key points whose
 * verdict vectors were identical across every graded candidate. That shortlist
 * is a reason to look, not a finding, and this call is what decides.
 *
 * ## The prompt asks for CONSTRUCTION, not for an opinion
 *
 * "Are these two points independent?" is a question a model answers with a
 * plausible-sounding yes. "Write an answer that states the first and does not
 * satisfy the second" is a question it either can or cannot do, and the attempt
 * is checkable by a human reading the report. The same reason the discrimination
 * test writes adversaries instead of asking whether the points are good.
 *
 * So both directions are requested as EXAMPLES, and the boolean is derived from
 * whether an example exists. A model that claims a direction is possible and
 * then writes nothing has not demonstrated it.
 *
 * ## Both directions in ONE call, deliberately
 *
 * Elsewhere in this pipeline candidates are graded in isolation, because a
 * grader shown several answers ranks them instead of judging each. That risk
 * does not apply here: the question is *inherently* about a pair, and splitting
 * it into two calls would let the model answer the second without knowing what
 * it claimed in the first — producing "A without B is impossible" and "B
 * without A is impossible" from two independent guesses, which reads as
 * equivalence and is the strongest claim in the vocabulary.
 *
 * The two directions are labelled FIRST and SECOND rather than by the key
 * points' positions on the card, so nothing signals which one the pipeline
 * might consider primary.
 */
export const PROBE_INDEPENDENCE_PROMPT = {
  id: 'probe-independence',
  version: 1,
  schema: IndependenceProbeSchema,

  build(input: ProbeIndependenceBuildInput): string {
    return `Two statements below are both things a good answer to the same interview question should contain. I need to know whether they are genuinely two separate claims, or whether one of them follows from the other.

Question: ${input.question}

FIRST statement:  ${input.textA}
SECOND statement: ${input.textB}

Answer by attempting two constructions.

1. Write a short answer to the question that clearly states the FIRST statement and does NOT satisfy the SECOND. It does not need to be a good answer overall — it only has to be one a reader would judge as containing the first claim and not the second.

2. Write a short answer that clearly states the SECOND and does NOT satisfy the FIRST.

If a construction is impossible — because anyone stating the one necessarily commits to the other — say so and leave that example empty. Impossibility is a real and useful answer; do not force a contrived example to fill the slot. But do not claim impossibility merely because an answer omitting the other point would be incomplete or unnatural: the test is whether it can be done at all, not whether it would be a good answer.

Output JSON:
{
  "aWithoutB": boolean,
  "exampleAWithoutB": string,
  "bWithoutA": boolean,
  "exampleBWithoutA": string,
  "note": string
}

Set a boolean true ONLY if you actually wrote the corresponding example. "note": one sentence on the relationship — if one entails the other, say which and why.`;
  },
};
