import { PanelGradeReviewSchema } from '@/lib/ai/schemas';
import type { PromptKlp } from './multiple-choice';

export interface ReviewPanelGradeBuildInput {
  question: string;
  referenceAnswer: string | null;
  klps: PromptKlp[];
  answerText: string;
  /** The grader's own isolated verdicts, by ref — what it is being asked to reconsider. */
  graderVerdicts: { ref: number; status: string; quote?: string }[];
  /** The adversary's stated intent: the level or band it wrote the answer to, and its rationale. */
  intendedLabel: string;
  intendedRationale: string;
  /** Where the grader's score landed versus where the adversary aimed, in plain words. */
  disagreement: string;
}

/**
 * THE RECONCILIATION PASS (2026-09-18, owner's ask) — benchmark-only, never
 * the runtime. After an answer has been graded ALONE (the measurement), and
 * only when that grade disagrees with the adversary's intent (a rank
 * inversion or a band miss), the grader is shown the adversary's rationale
 * and asked to reconsider each disputed point: accept the adversary's
 * reading, or hold its own, with a reason and a stated firmness.
 *
 * TypeScript turns the per-point stances into one of three outcomes:
 * `agree` (accepted every disputed point), `disagree` (held some, not
 * firmly), `strong` (held at least one FIRMLY) — and `strong` goes to the
 * owner's manual-review queue. The isolated verdict is never overwritten;
 * the review is a second row. The accepted corrections are the calibration
 * corpus the next grader version is written against.
 *
 * The grader has no weights to update online; this is the honest analogue —
 * disagreements are recorded, the pattern is read, the prompt or the rubric
 * weights change per version, and the benchmark says whether it helped.
 */
export const REVIEW_PANEL_GRADE_PROMPT = {
  id: 'review-panel-grade',
  // v2 (2026-09-19): a third stance, "klp_defect" — the point itself is the
  // problem. Routed to the authoring loop and, where the card lacks what the
  // point needs, to the owner (see src/lib/analysis/benchmark-review.ts).
  // v3 (2026-09-19): "cardGaps" — what a strong answer says that NO key point
  // covers. The question-only blind panel's first run produced thirty firm
  // holds and zero defects: the grader was right about every point and the
  // disagreement was about points the card does not have.
  // v4 (2026-09-20): a gap is { claim, reasoning } — the owner's rule that a
  // gap must say WHY ("generally cheaper because of the tax shield"), never a
  // bare generalisation. Gaps are now routed into the authoring loop
  // (src/lib/klp/gap-routing.ts), so the bar for one is the bar for a point.
  version: 4,
  schema: PanelGradeReviewSchema,
  build(input: ReviewPanelGradeBuildInput): string {
    const klps = input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n');
    const verdicts = input.graderVerdicts.map((v) => `[${v.ref}] ${v.status}${v.quote ? ` — "${v.quote}"` : ''}`).join('\n');
    return `You graded a candidate's answer to an interview question against a list of key points, one point at a time, without seeing anything else. A second reader — who wrote the answer deliberately, to a stated level — disagrees with how it came out. Your job now is to RECONSIDER, point by point, and say whether you accept the second reader's account or hold your own. You are not being asked to be agreeable: hold your verdict wherever the answer's own text supports it, and say so firmly. Accept only where the text, read again, supports the second reader.

Question: ${input.question}
${input.referenceAnswer ? `Reference answer: ${input.referenceAnswer}\n` : ''}
Key points:
${klps}

The candidate's answer:
${input.answerText}

Your isolated verdicts:
${verdicts}

The second reader wrote this answer to be "${input.intendedLabel}" and explains: ${input.intendedRationale}

The disagreement: ${input.disagreement}

For EVERY key point the second reader's account bears on, return { "klpRef": number, "stance": "accept" | "hold" | "klp_defect", "verdict": the verdict you now give (your original one when holding or naming a defect), "firm": true|false, "reason": one sentence citing the answer's words }. "firm" is true when you would defend the verdict to a third reader — an unclear text is not firm.

Use "klp_defect" when NEITHER of you is wrong because the KEY POINT is: it is ambiguous (two readings, and the answer satisfies one), compound (two claims joined so that stating one still fails it), or it asks for something the QUESTION does not — a competent candidate answering this question as asked would not say it. In "reason", say which of the three and, if the card should carry a different or additional point, state that point in one sentence starting "The card needs:". Do not use "klp_defect" for a point that is merely hard; a hard point a strong answer states is a good point.

Then "cardGaps": claims THIS ANSWER makes that a strong answer to this question genuinely needs and that NO key point above covers. Each is { "claim": the specific claim, one clause, scoped honestly ("generally", "when …") rather than absolute, "reasoning": WHY it holds, one clause, the mechanism a candidate would give }. Example: { "claim": "Debt is generally cheaper than equity", "reasoning": "interest is tax-deductible, so the after-tax cost of debt is below the cost of equity" }. A claim with no mechanism behind it — "debt is cheaper than equity", "leverage amplifies returns" — is a generalisation, not a gap; do not list it. This is not about any existing point; it is what the list is missing, and it becomes a key point of the card, so hold it to that bar. An answer that adds nothing a strong answer needs returns []. Be strict: a strong interviewer would expect it, not merely accept it.

Then return "summary": one sentence on where the second reader was right and where not.

Output JSON: { "points": [ { "klpRef": number, "stance": string, "verdict": string, "firm": boolean, "reason": string } ], "cardGaps": [ { "claim": string, "reasoning": string } ], "summary": string }`;
  },
};
