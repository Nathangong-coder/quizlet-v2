import { z } from 'zod';
import { KLP_KINDS } from '@/lib/ai/schemas';
import { REBUILT_ISSUE_KINDS } from '@/lib/klp/compression';

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
  // v2 (2026-09-14): instructions first, card last (prefix cache).
  version: 2,
  schema: ReferenceReviewSchema,

  build(input: ReviewReferenceBuildInput): string {
    return `You are reviewing a model answer to a finance interview question on three things: is it right, is it as short as it should be, and is it clear. Be a fair first-pass judge — flag what a good interviewer would actually object to, not every possible nit. The card owner's own definition is the accuracy anchor: the answer may say more, but must not contradict it.

ACCURACY — "sound": the claims are correct and the answer COMMITS to its conclusion. "hedged": it avoids a conclusion the question settles — the numbers or facts given decide the answer, yet it says "if", "depending on", "could" where it should say which. "wrong": a substantive claim is incorrect or contradicts the definition. Quote the sentence in "issues".
CONCISENESS — "tight": every sentence does work. "wordy": it would be better at two-thirds the length; name the repetition or the restated point. "bloated": it is more than twice as long as a strong spoken answer needs, or restates its conclusion more than once.
CLARITY — "clear": a listener could follow the structure and knows what was concluded. "muddled": the order or the wording obscures the point; name where.

Output JSON:
{ "accuracy": "sound" | "hedged" | "wrong", "conciseness": "tight" | "wordy" | "bloated", "clarity": "clear" | "muddled", "issues": [ { "kind": "accuracy" | "conciseness" | "clarity", "text": string } ] }
"issues" is empty when everything is sound, tight and clear. Each issue is ONE sentence naming the specific passage.

Question: ${input.question}

The card owner's own definition:
${input.definition}

The answer:
${input.answer}`;
  },
};

// ---------------------------------------------------------------------------
// The REBUILT answer, reviewed against the numbered key points (step A of the
// compression plan, 2026-09-13). Same labels, but every issue names the
// points responsible, so it can be a per-point finding in the revise call.
// ---------------------------------------------------------------------------

export const RebuiltReviewSchema = z.object({
  conciseness: z.enum(CONCISENESS_VERDICTS),
  clarity: z.enum(CLARITY_VERDICTS),
  issues: z
    .array(
      z.object({
        kind: z.enum(REBUILT_ISSUE_KINDS),
        /** Indices into the key-point list the issue is about; empty for a transition. */
        points: z.array(z.number().int().min(0)).default([]),
        text: z.string().min(1),
      }),
    )
    .default([]),
});

export interface ReviewRebuiltBuildInput {
  question: string;
  definition: string;
  rebuiltAnswer: string;
  klps: { text: string }[];
}

export const REVIEW_REBUILT_PROMPT = {
  id: 'review-rebuilt',
  // v2 (2026-09-14): instructions first, card last (prefix cache).
  version: 2,
  schema: RebuiltReviewSchema,

  build(input: ReviewRebuiltBuildInput): string {
    const points = input.klps.map((k, i) => `[${i}] ${k.text}`).join('\n');
    return `An answer to a finance interview question was written from a numbered list of key points and nothing else. Review it for length and clarity, and for every problem name the key points that caused it — the points are what will be edited, not the answer. The card owner's definition is what the answer is supposed to cover.

CONCISENESS — "tight": every sentence does work. "wordy": it would be better at two-thirds the length. "bloated": more than twice what a strong spoken answer needs, or the conclusion restated more than once.
CLARITY — "clear" or "muddled" (the order or wording obscures the point).

Issues, each with a kind and the point indices responsible:
- "restatement": two or more points make the same claim in different words (for example an opening definition and a closing contrast that both say the conclusion). List every point involved.
- "clause_bloat": a point carries a because-/which-clause that adds words but no separately testable claim. List that point.
- "not_on_card": a point states something the owner's definition does not carry and the answer does not need to reach its conclusion. List that point.
- "transition": roadmap sentences, restated conclusions or connective filler the ANSWER added that no point contains. No points.

Output JSON:
{ "conciseness": "tight" | "wordy" | "bloated", "clarity": "clear" | "muddled", "issues": [ { "kind": "restatement" | "clause_bloat" | "not_on_card" | "transition", "points": [ number ], "text": string } ] }
"issues" is empty when the answer is tight and clear. Each "text" is ONE sentence.

Question: ${input.question}

The card owner's definition:
${input.definition}

The key points the answer was built from:
${points}

The answer:
${input.rebuiltAnswer}`;
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
  // v2 (2026-09-14): instructions first, card last (prefix cache).
  version: 2,
  schema: ReviseReferenceSchema,

  build(input: ReviseReferenceBuildInput): string {
    const issues = input.review.issues.map((i) => `- ${i.kind.toUpperCase()}: ${i.text}`).join('\n');
    const verdicts = `accuracy ${input.review.accuracy}, conciseness ${input.review.conciseness}, clarity ${input.review.clarity}`;
    const klps = input.klps.map((k, i) => `[${i}] (${k.kind}) ${k.text}`).join('\n');
    return `You wrote a model answer and its Key Learning Points for a finance interview question, and a reviewer read the answer. Do not contradict the card owner's definition; where you think it is wrong, keep your objection out of the answer.

Rewrite the answer so a reviewer would call it sound, tight and clear:
- ACCURACY: if a conclusion was hedged and the question's facts settle it, STATE it — say which, and say why in one clause. If a claim was wrong, correct it.
- CONCISENESS: cut repetition and restated conclusions; keep every claim a strong candidate needs. Aim for the length a strong candidate would actually speak.
- CLARITY: keep the order a strong answer delivers — define the term, develop, land the conclusion.
Then re-derive the key points FROM the rewritten answer: keep every point the rewrite still supports, word for word where its claim is unchanged; drop a point the rewrite no longer makes; add one only for a claim the rewrite newly commits to. Same kinds: ${KLP_KINDS.join(', ')}.

Output JSON: { "referenceAnswer": string, "klps": [ { "text": string, "kind": string } ] }

Question: ${input.question}

The card owner's definition:
${input.definition}

Your answer:
${input.referenceAnswer}

Your key points:
${klps}

The reviewer found: ${verdicts}.
Reviewer's issues:
${issues || '- (none listed)'}`;
  },
};
