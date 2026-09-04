import { AuthorDraftSchema, KLP_KINDS } from '@/lib/ai/schemas';
import { MIN_KLPS_PER_CARD, MAX_KLPS_AUTHORED, PROBE_KINDS } from '@/lib/klp/authoring-config';

export interface AuthorKlpsBuildInput {
  setTitle: string;
  term: string;
  definition: string;
}

/**
 * Call A of the authoring pipeline (`src/lib/klp/authoring.ts`). One card.
 *
 * Order matters and is pinned by a test: the reference answer comes FIRST,
 * because the KLPs must be derived FROM that artifact rather than invented
 * independently — a KLP the reference does not support was hallucinated past
 * what it was supposed to be derived from, and call B's discrimination test
 * catches exactly that.
 *
 * Routed via the `author` task — judgment-heavy, runs rarely, unlike the
 * cheap-tier legacy extractor this pipeline sits beside.
 */
export const AUTHOR_KLPS_PROMPT = {
  id: 'author-klps',
  version: 1,
  schema: AuthorDraftSchema,

  build(input: AuthorKlpsBuildInput): string {
    return `You are a finance interview coach building a discrimination-tested question from one flashcard.

Study set: ${input.setTitle}
Term: ${input.term}
Definition: ${input.definition}

Do this in order.

1. REFERENCE ANSWER — first, before anything else. Write the answer you would expect from a strong candidate who has fully prepared this card: complete, correct, and at the bar of a real interview response. Every Key Learning Point below must be something THIS answer actually says, not something you separately believe is true about the topic.

2. KEY LEARNING POINTS (KLPs) — extracted FROM the reference answer above, not from the definition directly. A KLP is a PROPOSITION a grader can judge true or false against a candidate's answer, never a topic or a heading.
   GOOD: "Depreciation is added back because it is a non-cash charge"
   BAD:  "non-cash charges"
   Target ${MIN_KLPS_PER_CARD}-${MAX_KLPS_AUTHORED} KLPs. This is a SMELL TEST, NOT A QUOTA — an atomic card genuinely has one point, and the discrimination test that follows this call is what actually decides whether each KLP earns its place. Do NOT pad the list to reach the low end; a padded KLP fires identically on every answer and is worthless.
   kind: one of ${KLP_KINDS.join(', ')}.

3. EXACTLY THREE WRONG ANSWERS, one for each archetype below. Each must be WRITTEN TO FAIL specific KLPs above — not a random bad answer, but one that deliberately misses particular points while still sounding like a real attempt.
   - confident_wrong: articulate and structured, but wrong — it should read as if the candidate is sure of themselves while missing the substance.
   - vague: refuses to commit to specifics; gestures at the right area without stating the actual claims.
   - memorized_template: has the right shape and vocabulary of a strong answer — the structure a template gives you — but no real substance underneath it.

Output JSON:
{
  "referenceAnswer": string,
  "klps": [ { "text": string, "kind": string } ],
  "wrongAnswers": [
    { "kind": "confident_wrong" | "vague" | "memorized_template", "text": string }
  ]
}
The three wrongAnswers entries must cover exactly ${PROBE_KINDS.join(', ')}, one each.`;
  },
};
