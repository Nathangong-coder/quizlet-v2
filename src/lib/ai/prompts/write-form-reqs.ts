import { FormRequirementsSchema } from '@/lib/ai/schemas';

export interface WriteFormReqsBuildInput {
  /** The card's term — what is being asked. */
  question: string;
  definition: string;
  /** `CardAuthoring.referenceAnswer` at the card's current klpVersion. */
  referenceAnswer: string;
  /** The live key points, in index order. Listed so the writer does NOT restate them. */
  klps: { text: string; kind: string }[];
}

/**
 * Spec 5 §5 — the form-requirements pass. One call per card, over the
 * existing reference answer and the live key points; never a re-author.
 *
 * A form requirement is a SHAPE rule: answers the question asked, states
 * direction and magnitude, presents steps in causal order, closes the loop.
 * They catch the failure every content metric misses — a fluent 6-of-7
 * answer to a slightly different question, which is the memorised-template
 * trap by construction — so the prompt says in so many words that a
 * requirement is something such an answer would FAIL, and that the key
 * points already cover what must be PRESENT.
 *
 * Grader-family task (`form-reqs`): these are judgments about the question,
 * not writing. Version 1; the version is persisted on every
 * `CardFormRequirement` row.
 */
export const WRITE_FORM_REQS_PROMPT = {
  id: 'write-form-reqs',
  version: 1,
  schema: FormRequirementsSchema,
  build(input: WriteFormReqsBuildInput): string {
    return `You are writing FORM REQUIREMENTS for one interview question: 3-5 rules about the SHAPE a complete answer must have, as distinct from its content. The key points below already say what must be PRESENT; do not restate them. A form requirement is something a fluent answer to a slightly different question would FAIL.

The four archetypes (use the ones that apply, phrased for THIS question):
- answers the question asked (not the neighbouring one)
- states direction and magnitude where the question has them
- presents steps in causal order (setup → mechanism → result)
- closes the loop: lands the conclusion the question asked for

Each requirement is one sentence, at most 160 characters, checkable by a grader reading the answer alone.

Question: ${input.question}
Definition on the card: ${input.definition}
Reference answer: ${input.referenceAnswer}
Key points (do NOT restate these):
${input.klps.map((k, i) => `[${i}] (${k.kind}) ${k.text}`).join('\n')}

Output JSON: { "requirements": [ { "text": string } ] }`;
  },
};
