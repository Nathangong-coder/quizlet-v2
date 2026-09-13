import { AuthorDraftSchema, AuthorDraftBatchSchema, KLP_KINDS } from '@/lib/ai/schemas';
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
 * VERSION 3 (2026-09-12), from the owner's read of the role-split bench:
 *  5. QUESTION TYPE FIRST. The prompt classifies the question (`QUESTION_TYPES`)
 *     and follows a structure rule per type. Every type opens by DEFINING the
 *     term the question turns on, and that definition is key point [0] — the
 *     owner's "define the term first" on "what are 2 ways an acquisition can
 *     create value". An ENUMERATION keeps its N items as knowledge-grain key
 *     points with mechanism points attached, never dissolved into a chain —
 *     the value-creation card had been authored as the dissolved form.
 *  6. THE COUNT LEAN. Gemini wrote ~5 points a card and DeepSeek ~8; the owner
 *     asked for two-thirds toward Gemini, one-third toward DeepSeek, which is
 *     about six. The prompt now names floor+1 to floor+3 as the usual right
 *     number and allows one short context clause per point.
 *
 * Routed via the `author` task — judgment-heavy, runs rarely, unlike the
 * cheap-tier legacy extractor this pipeline sits beside.
 */
export const AUTHOR_KLPS_PROMPT = {
  id: 'author-klps',
  // v4 (2026-09-13): two wrong answers — `confident_wrong` cut, see PROBE_KINDS.
  version: 4,
  schema: AuthorDraftSchema,

  build(input: AuthorKlpsBuildInput): string {
    return `You are a finance interview coach building a discrimination-tested question from one flashcard.

Study set: ${input.setTitle}
Term: ${input.term}
Definition (written by the card's owner): ${input.definition}

${authorBody({
  floor: `Write AT LEAST ${input.minKlps} KLPs, up to ${MAX_KLPS_AUTHORED}; the usual right number is ${input.minKlps + 1} to ${Math.min(MAX_KLPS_AUTHORED, input.minKlps + 3)}.`,
})}

Output JSON:
${DRAFT_JSON_SHAPE}
${DRAFT_JSON_NOTES}`;
  },
};

/**
 * The shared instruction body — identical between the single-card prompt and
 * the batch prompt below except for the sizing sentence, which names a number
 * for one card and "the floor given for that card" for a batch.
 */
function authorBody(opts: { floor: string }): string {
  return `THE DEFINITION IS YOUR SKELETON, NOT A HINT. It is terse by nature and it is the content the owner has already vetted. Your reference answer must follow it: expand each point it makes to the depth a strong spoken answer would give, THEN add what a strong answer needs that the card omits. Do not contradict it. Where it is incomplete, extend it. Where you believe it is actually WRONG, say so in "concerns" — do not silently correct it. A card the owner never learns is wrong stays wrong.

Do this in order.

0. QUESTION TYPE — classify the question as ONE of: define (what is X / explain X), enumerate (what are the N ways / list the ...), walkthrough (walk me through / how does X work), why (why does / why might), compare (X vs Y / the difference between), scenario (here are numbers or a situation — what is it, what happens), calculate (how is X computed / compute X). Put it in "questionType". The type sets the SHAPE of the answer and of the key points:
   - EVERY type opens by DEFINING THE TERM the question turns on, in one sentence, before anything else — a strong candidate anchors the answer before developing it. That definition is the FIRST key point.
   - define: the definition, then what it is for, then the one distinction or nuance a strong candidate adds.
   - enumerate: after the definition, EACH of the N items is its own key point at knowledge grain, in the order a strong answer gives them ("the first way is X"), and each may be FOLLOWED by one mechanism or causal point that explains it. Never dissolve the list into a chain of mechanisms — a learner must be able to be marked right on item 2 and wrong on item 3.
   - walkthrough: the definition, then the steps in the order they happen, then where it ends up.
   - why: the definition, the claim, the mechanism, the consequence — the last point lands the why.
   - compare: the definition of each side, then the one difference that decides which to use.
   - scenario: what the situation is, the evidence in the numbers that says so, then the reasoning.
   - calculate: the definition, the formula in words, then what moves it.

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

   ${opts.floor} That floor comes from how much the definition already covers and how much of it needs expanding. It is a FLOOR YOU MAY EXCEED, NOT A QUOTA TO PAD TO — the discrimination test that follows this call decides whether each KLP earns its place, and a padded KLP fires identically on every answer, so it is worse than absent. A key point may carry ONE short context clause — "because ...", "which is why ..." — where the bare claim would be less useful to learn from; it stays one proposition.
   kind: one of ${KLP_KINDS.join(', ')}.

4. EXACTLY TWO WRONG ANSWERS, one for each archetype below. Each must be WRITTEN TO FAIL specific KLPs above — not a random bad answer, but one that deliberately misses particular points while still sounding like a real attempt.
   - vague: refuses to commit to specifics; gestures at the right area without stating the actual claims.
   - memorized_template: has the right shape and vocabulary of a strong answer — the structure a template gives you — but no real substance underneath it.`;
}

const DRAFT_JSON_SHAPE = `{
  "questionType": "define" | "enumerate" | "walkthrough" | "why" | "compare" | "scenario" | "calculate",
  "definitionPoints": [ { "point": string, "klpsNeeded": number } ],
  "referenceAnswer": string,
  "concerns": [ string ],
  "klps": [ { "text": string, "kind": string } ],
  "wrongAnswers": [
    { "kind": "vague" | "memorized_template", "text": string }
  ]
}`;

const DRAFT_JSON_NOTES = `"concerns" is an empty array when the definition is sound — say nothing rather than inventing a criticism.
The wrongAnswers entries must cover exactly ${PROBE_KINDS.join(', ')}, one each.`;

export interface AuthorKlpsBatchBuildInput {
  setTitle: string;
  cards: { ref: number; term: string; definition: string; minKlps: number }[];
}

/**
 * The batched author call (2026-09-13, cost item 4). The instruction body is
 * ~1.5k tokens and a card is ~300; one call per card re-sent the body every
 * time. This sends it once for N cards and asks for one draft per card,
 * addressed by `ref` (position in the batch, never an id).
 *
 * Judgment per card is unchanged — the body is byte-identical to the single
 * prompt's — but the OUTPUT budget grows with N: a draft is ~2k tokens and
 * GLM's reasoning is on top, so `KLP_AUTHOR_BATCH` stays small (5) and a
 * batch whose reply fails the schema falls back to single calls for its cards
 * rather than being retried as a batch.
 */
export const AUTHOR_KLPS_BATCH_PROMPT = {
  id: 'author-klps-batch',
  version: 1,
  schema: AuthorDraftBatchSchema,

  build(input: AuthorKlpsBatchBuildInput): string {
    const cards = input.cards
      .map((c) => `[${c.ref}] Term: ${c.term}\n    Definition (written by the card's owner): ${c.definition}\n    Floor: at least ${c.minKlps} KLPs; the usual right number is ${c.minKlps + 1} to ${Math.min(MAX_KLPS_AUTHORED, c.minKlps + 3)}.`)
      .join('\n\n');
    return `You are a finance interview coach building a discrimination-tested question from EACH of ${input.cards.length} flashcards. Treat every card on its own: nothing you write for one card may lean on another.

Study set: ${input.setTitle}

Cards:
${cards}

For EACH card, do the following.

${authorBody({ floor: `Write AT LEAST the floor given for that card, up to ${MAX_KLPS_AUTHORED}; its usual right number is stated with the card.` })}

Output JSON — one entry per card, in the order given, "ref" copied from the card's [number]:
{ "cards": [ { "ref": number, ...one object of this shape per card:
${DRAFT_JSON_SHAPE}
} ] }
${DRAFT_JSON_NOTES}`;
  },
};
