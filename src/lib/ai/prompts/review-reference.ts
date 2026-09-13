import { z } from 'zod';
import { KLP_KINDS } from '@/lib/ai/schemas';

/**
 * THE COMMUNICATION CHECK (2026-09-13, owner).
 *
 * Two things the separation test cannot see: a reference answer that is
 * WORDY (every key point it spawns inherits the bloat, and the rebuilt
 * answers read like essays) and one that HEDGES a conclusion the numbers
 * settle ("if the deal's IRR clears the 6% hurdle" on a card that gives the
 * IRR — the writer did not have the mechanics and wrote around it). Both
 * were read off the definition-length spread.
 *
 * The reviewer is a model from the GRADER family, never the writer: a writer
 * that lacks a mechanism will not notice the hedge it wrote to cover it. The
 * owner's stance on the judge: "models are a good enough first-pass judge
 * that it won't be too strict when it matters; if it's too lenient that's
 * sort of okay". So the rubric is categorical and coarse, and TypeScript
 * decides what triggers a rewrite (`referenceNeedsRewrite`).
 *
 * The same prompt reviews the REBUILT answer after the loop, so the two can
 * be compared: a reference that was tight and a rebuild that is wordy means
 * the key points, not the writer, are carrying the bloat.
 */

export const ACCURACY_VERDICTS = ['sound', 'hedged', 'wrong'] as const;
export const CONCISENESS_VERDICTS = ['tight', 'wordy', 'bloated'] as const;
export const CLARITY_VERDICTS = ['clear', 'muddled'] as const;

export const ReferenceReviewSchema = z.object({
  accuracy: z.enum(ACCURACY_VERDICTS),
  conciseness: z.enum(CONCISENESS_VERDICTS),
  clarity: z.enum(CLARITY_VERDICTS),
  /** Concrete, quotable problems — the material a rewrite is asked to fix. */
  issues: z
    .array(
      z.object({
        kind: z.enum(['accuracy', 'conciseness', 'clarity']),
        text: z.string().min(1),
      }),
    )
    .default([]),
});

export type ReferenceReview = z.infer<typeof ReferenceReviewSchema>;

export interface ReviewReferenceBuildInput {
  question: string;
  answer: string;
  /** The card owner's definition — the accuracy anchor. */
  definition: string;
}

export const REVIEW_REFERENCE_PROMPT = {
  id: 'review-reference',
  version: 1,
  schema: ReferenceReviewSchema,

  build(input: ReviewReferenceBuildInput): string {
    return `You are reviewing a model answer to a finance interview question on three things: is it right, is it as short as it should be, and is it clear. Be a fair first-pass judge — flag what a good interviewer would actually object to, not every possible nit.

Question: ${input.question}

The card owner's own definition (treat as the accuracy anchor; the answer may say more, but must not contradict it):
${input.definition}

The answer:
${input.answer}

ACCURACY — "sound": the claims are correct and the answer COMMITS to its conclusion. "hedged": it avoids a conclusion the question settles — the numbers or facts given decide the answer, yet it says "if", "depending on", "could" where it should say which. "wrong": a substantive claim is incorrect or contradicts the definition. Quote the sentence in "issues".
CONCISENESS — "tight": every sentence does work. "wordy": it would be better at two-thirds the length; name the repetition or the restated point. "bloated": it is more than twice as long as a strong spoken answer needs, or restates its conclusion more than once.
CLARITY — "clear": a listener could follow the structure and knows what was concluded. "muddled": the order or the wording obscures the point; name where.

Output JSON:
{ "accuracy": "sound" | "hedged" | "wrong", "conciseness": "tight" | "wordy" | "bloated", "clarity": "clear" | "muddled", "issues": [ { "kind": "accuracy" | "conciseness" | "clarity", "text": string } ] }
"issues" is empty when everything is sound, tight and clear. Each issue is ONE sentence naming the specific passage.`;
  },
};

/** TypeScript decides; the model only labels. */
export function referenceNeedsRewrite(review: ReferenceReview): boolean {
  return review.accuracy !== 'sound' || review.conciseness !== 'tight' || review.clarity !== 'clear';
}

// ---------------------------------------------------------------------------
// The rewrite, by the WRITER, before the discrimination test runs.
// ---------------------------------------------------------------------------

export const ReviseReferenceSchema = z.object({
  referenceAnswer: z.string().min(1),
  klps: z.array(z.object({ text: z.string().min(1), kind: z.enum(KLP_KINDS) })).min(1),
});

export interface ReviseReferenceBuildInput {
  question: string;
  definition: string;
  referenceAnswer: string;
  klps: { text: string; kind: string }[];
  review: ReferenceReview;
}

export const REVISE_REFERENCE_PROMPT = {
  id: 'revise-reference',
  version: 1,
  schema: ReviseReferenceSchema,

  build(input: ReviseReferenceBuildInput): string {
    const issues = input.review.issues.map((i) => `- ${i.kind.toUpperCase()}: ${i.text}`).join('\n');
    const verdicts = `accuracy ${input.review.accuracy}, conciseness ${input.review.conciseness}, clarity ${input.review.clarity}`;
    const klps = input.klps.map((k, i) => `[${i}] (${k.kind}) ${k.text}`).join('\n');
    return `You wrote a model answer and its Key Learning Points for a finance interview question. A reviewer read the answer and found: ${verdicts}.

Question: ${input.question}

The card owner's definition (do not contradict it; where you think it is wrong, keep your objection out of the answer):
${input.definition}

Your answer:
${input.referenceAnswer}

Your key points:
${klps}

Reviewer's issues:
${issues || '- (none listed)'}

Rewrite the answer so a reviewer would call it sound, tight and clear:
- ACCURACY: if a conclusion was hedged and the question's facts settle it, STATE it — say which, and say why in one clause. If a claim was wrong, correct it.
- CONCISENESS: cut repetition and restated conclusions; keep every claim a strong candidate needs. Aim for the length a strong candidate would actually speak.
- CLARITY: keep the order a strong answer delivers — define the term, develop, land the conclusion.
Then re-derive the key points FROM the rewritten answer: keep every point the rewrite still supports, word for word where its claim is unchanged; drop a point the rewrite no longer makes; add one only for a claim the rewrite newly commits to. Same kinds: ${KLP_KINDS.join(', ')}.

Output JSON: { "referenceAnswer": string, "klps": [ { "text": string, "kind": string } ] }`;
  },
};
