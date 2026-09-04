import { AuthorDraftSchema, KLP_KINDS } from '@/lib/ai/schemas';
import { MAX_KLPS_AUTHORED, PROBE_KINDS } from '@/lib/klp/authoring-config';

export interface AuthorKlpsBuildInput {
  setTitle: string;
  term: string;
  definition: string;
  /**
   * The mechanical sizing prior (`src/lib/klp/sizing.ts`), computed in
   * TypeScript from the definition's clause count and the two lengths, and
   * already floored at `MIN_KLPS_FLOOR`. A FLOOR the model may exceed, never a
   * quota it must hit — the discrimination test still decides which KLPs earn
   * their place, and a padded KLP fires identically on every answer.
   */
  minKlps: number;
}

/**
 * Call A of the authoring pipeline (`src/lib/klp/authoring.ts`). One card.
 *
 * Order matters and is pinned by a test: the reference answer comes BEFORE the
 * KLPs, because the KLPs must be derived FROM that artifact rather than
 * invented independently — a KLP the reference does not support was
 * hallucinated past what it was supposed to be derived from, and call B's
 * discrimination test catches exactly that.
 *
 * VERSION 2 (increment A) makes four changes, each traceable to the owner's
 * review of the first real pipeline output:
 *
 *  1. THE DEFINITION IS THE SKELETON, not a hint. Version 1 handed the model
 *     `term` and `definition` and let it write a reference answer freely, which
 *     is how "slightly inaccurate" claims about debt got in: nothing bound the
 *     model to content the owner had already vetted. Now it expands each point
 *     the definition makes, then adds what a strong answer needs and the card
 *     omits — and where it thinks the definition is WRONG it says so in
 *     `concerns` instead of silently rewriting it.
 *  2. ORDERING IS SEMANTIC. `CardKlp.index` was array position and carried no
 *     meaning. KLPs are now ordered as a strong answer delivers them — setup,
 *     then mechanism, then payoff — with the last one explicitly landing the
 *     answer to the question that was actually asked. Half of this is
 *     mechanically checkable (`findOrderingDefects` cross-checks the stored
 *     order against `precedes` edges); the setup/payoff framing is not, and
 *     stays an instruction.
 *  3. PRACTITIONER PHRASING, taught by a concrete contrast pair rather than an
 *     abstract instruction to "be clear". The owner's own example: "increases
 *     IRR by reducing the calculation's denominator" is technically defensible
 *     and pedagogically poor. Negative examples move model output; adjectives
 *     do not.
 *  4. ADAPTIVE SIZING. `minKlps` arrives precomputed, and the model returns a
 *     per-point detail assessment (`definitionPoints`) that TypeScript sums —
 *     it never states a total itself.
 *
 * Routed via the `author` task — judgment-heavy, runs rarely, unlike the
 * cheap-tier legacy extractor this pipeline sits beside.
 */
export const AUTHOR_KLPS_PROMPT = {
  id: 'author-klps',
  version: 2,
  schema: AuthorDraftSchema,

  build(input: AuthorKlpsBuildInput): string {
    return `You are a finance interview coach building a discrimination-tested question from one flashcard.

Study set: ${input.setTitle}
Term: ${input.term}
Definition (written by the card's owner): ${input.definition}

THE DEFINITION IS YOUR SKELETON, NOT A HINT. It is terse by nature and it is the content the owner has already vetted. Your reference answer must follow it: expand each point it makes to the depth a strong spoken answer would give, THEN add what a strong answer needs that the card omits. Do not contradict it. Where it is incomplete, extend it. Where you believe it is actually WRONG, say so in "concerns" — do not silently correct it. A card the owner never learns is wrong stays wrong.

Do this in order.

1. DEFINITION POINTS — list the distinct points the definition already makes, in the order it makes them. For each, say how many Key Learning Points it takes to cover once expanded ("klpsNeeded", usually 1-3). This is an assessment of DETAIL, not a total to hit; something else adds them up.

2. REFERENCE ANSWER — the answer you would expect from a strong candidate who has fully prepared this card: complete, correct, and at the bar of a real interview response, built on the skeleton above. Every Key Learning Point below must be something THIS answer actually says, not something you separately believe is true about the topic.

3. KEY LEARNING POINTS (KLPs) — extracted FROM the reference answer above, not from the definition directly. A KLP is a PROPOSITION a grader can judge true or false against a candidate's answer, never a topic or a heading.
   GOOD: "Depreciation is added back because it is a non-cash charge"
   BAD:  "non-cash charges"

   ORDER THEM AS A STRONG ANSWER DELIVERS THEM: setup first, then the mechanism, then the payoff. The FINAL KLP must land the answer to the question that was actually asked — if the question is why something amplifies returns, the last point states the amplified return and names it. Do not open on the conclusion and do not bury it in the middle. If one point can only be understood after another, it must come after it.

   PHRASE THEM THE WAY A PRACTITIONER WOULD, not the way a formula would. A claim can be technically correct and still useless to learn from:
     NOT: "a smaller initial equity outlay increases IRR by reducing the calculation's denominator"
     BUT: "the same dollar gain is measured against a smaller equity base, so it is a larger percentage return"
   The second explains; the first restates arithmetic.

   Write AT LEAST ${input.minKlps} KLPs, up to ${MAX_KLPS_AUTHORED}. That floor comes from how much the definition already covers and how much of it needs expanding. It is a FLOOR YOU MAY EXCEED, NOT A QUOTA TO PAD TO — the discrimination test that follows this call decides whether each KLP earns its place, and a padded KLP fires identically on every answer, so it is worse than absent.
   kind: one of ${KLP_KINDS.join(', ')}.

4. EXACTLY THREE WRONG ANSWERS, one for each archetype below. Each must be WRITTEN TO FAIL specific KLPs above — not a random bad answer, but one that deliberately misses particular points while still sounding like a real attempt.
   - confident_wrong: articulate and structured, but wrong — it should read as if the candidate is sure of themselves while missing the substance.
   - vague: refuses to commit to specifics; gestures at the right area without stating the actual claims.
   - memorized_template: has the right shape and vocabulary of a strong answer — the structure a template gives you — but no real substance underneath it.

Output JSON:
{
  "definitionPoints": [ { "point": string, "klpsNeeded": number } ],
  "referenceAnswer": string,
  "concerns": [ string ],
  "klps": [ { "text": string, "kind": string } ],
  "wrongAnswers": [
    { "kind": "confident_wrong" | "vague" | "memorized_template", "text": string }
  ]
}
"concerns" is an empty array when the definition is sound — say nothing rather than inventing a criticism.
The three wrongAnswers entries must cover exactly ${PROBE_KINDS.join(', ')}, one each.`;
  },
};
