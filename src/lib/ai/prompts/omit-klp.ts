import { OmitKlpSchema } from '@/lib/ai/schemas';

export interface OmitKlpBuildInput {
  question: string;
  /** The points that must still be covered — the set AS REDUCED SO FAR. */
  keep: { text: string }[];
  /** The single point this answer must not address. */
  omit: string;
}

/**
 * C4's construction call: write the best possible answer that covers the
 * remaining key points and says nothing about ONE of them.
 *
 * ## Why a construction rather than a question
 *
 * "Is this point necessary?" invites an opinion, and a model asked whether a
 * carefully-authored proposition matters will say yes. "Write the best answer
 * you can without it" is a task whose OUTPUT is then judged by something else —
 * the app's own grader, blind to the key points entirely. The verdict comes
 * from that judgment, not from this call.
 *
 * That is the same two-claim discipline C1 uses, pointed at a single omission:
 * necessity is just the exploit test restricted to one missing point.
 *
 * ## `keep` is the set AS REDUCED SO FAR, and that is R2
 *
 * The caller passes the survivors of the greedy loop, not the card's original
 * points. Two points each covering half of one idea both look optional when
 * judged against the full set; once the first is gone, the second is the only
 * thing carrying the idea and the answer written without it becomes visibly
 * worse.
 *
 * ## The prompt must not know what the answer is for
 *
 * It is never told that the point may be deleted, or that this is a quality
 * check. A model that knows it is being asked to justify a deletion writes a
 * deliberately poor answer; one that knows it is defending the point writes a
 * suspiciously complete one. It is asked only to answer the question well under
 * a constraint.
 */
export const OMIT_KLP_PROMPT = {
  id: 'omit-klp',
  version: 1,
  schema: OmitKlpSchema,

  build(input: OmitKlpBuildInput): string {
    const keep = input.keep.map((k, i) => `[${i}] ${k.text}`).join('\n');

    return `Answer the interview question below as well as you can, under one constraint.

Question: ${input.question}

Your answer should cover these points:
${keep}

CONSTRAINT: your answer must NOT state, imply, or depend on the following, and must not work around it with a paraphrase:
${input.omit}

Write the strongest answer that respects the constraint. Do not flag the omission, apologise for it, or mention that anything was left out — write it as a candidate would write it if that point simply never occurred to them.

If the constraint makes a coherent answer impossible — because every route to the question runs through the omitted point — say so and leave the answer empty. That is a real outcome, not a failure to comply.

Output JSON:
{ "answer": string, "impossible": boolean, "note": string }

"note": one sentence on what, if anything, the answer loses by respecting the constraint.`;
  },
};
