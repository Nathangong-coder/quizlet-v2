import { KLP_VERDICTS, type KlpVerdict } from '@/lib/klp/verdicts';

/**
 * Strict clause (2026-09-12, owner): credit a point only when the answer
 * states it explicitly; when in doubt, the lower verdict. Lives here, not in
 * `grade-candidate.ts`, so the block below can carry it without an import
 * cycle; `grade-candidate.ts` re-exports it for its existing importers.
 */
export const STRICT_GRADING_CLAUSE =
  'GRADE STRICTLY. Credit a key point only when the answer states it explicitly or entails it unmistakably. When in doubt between two verdicts, give the lower one. Do not infer what the candidate probably meant.';

/**
 * Kinds graded on SUBSTANCE rather than statement under strict mode
 * (2026-09-12, owner, read off the definition-length spread). A mechanism,
 * a condition or a number is established when the answer gets the steps, the
 * trigger and its consequence, or the figure and its direction right, however
 * it is phrased; a strict grader that wanted the point's wording failed
 * answers that plainly had the substance. Causal points stay strict: "because"
 * is exactly what a template answer fakes, and the spread showed the relaxed
 * reading credits it. Definition, contrast and example are strict too — a
 * definition that is only gestured at is not a definition.
 */
export const RELAXED_KINDS = ['mechanism', 'condition', 'quantitative'] as const;

export const KIND_STRICTNESS_CLAUSE = `Strictness by kind. Each key point is tagged with its kind. For a point tagged ${RELAXED_KINDS.join(', ')}: judge the SUBSTANCE — credit it when the answer establishes the same steps, the same condition and its consequence, or the same figure and direction, in its own words; withhold credit only when that substance is genuinely absent or wrong. For a point tagged causal: the answer must state the cause-and-effect link itself, not merely name both ends; naming a cause without saying what it does is at most "incomplete". Every other kind is graded strictly as above.`;

/**
 * THE SUBSTANCE FLOOR (2026-09-18, grader v3, owner's read of the benchmark).
 * Every expert/competent tie on the LBO bench was the same failure: the
 * answer GESTURED at a point and the grader credited it as stated. "Judge the
 * substance" had been read as "credit anything in the neighbourhood". This
 * clause says what substance means and what a gesture is worth: an allusion,
 * an adjacent idea, or a sentence a reader could infer the point from is
 * "incomplete", never "correct"; a compound point needs both halves; and a
 * sentence that implies the OPPOSITE mechanism is "contradicted", not a hole.
 * Applies under `strict`, i.e. to the runtime, diagnostic and authoring
 * graders alike — the KLPs are tested under the same standard they are
 * graded with.
 */
export const SUBSTANCE_FLOOR_CLAUSE = `What "substance" means. A point is "correct" only when the answer STATES the specific claim the point makes — the comparison it draws, the condition and its consequence, the figure, the direction — in a sentence a reader could not mistake for something else. It is "incomplete" when the answer only alludes to it, states an adjacent or more general idea, or leaves the reader to infer the point from something nearby; that includes a point with two claims joined by "so", "against", "within" or "because" when the answer makes only one of them. It is "contradicted" — not a hole — when a sentence implies the opposite mechanism, direction or comparison, even without naming the point. A fluent answer earns nothing for fluency: judge each point on its own sentence.`;

export interface VerdictBlockInput {
  strict: boolean;
  showKinds: boolean;
  /** The labels to offer. Authoring passes KLP_VERDICTS; the runtime passes RUNTIME_VERDICTS. */
  vocabulary?: readonly KlpVerdict[];
}

/**
 * ONE measured wording for "how to judge a key point", shared by the authoring
 * grader (grade-candidate), the runtime grader (grade-short-answer) and the
 * diagnostic grader. The vocabulary is listed VERBATIM and quoted, because a
 * model told "use a specific label" without the list invents one
 * (`missing_response`, 2026-09-06) and TypeScript then has nothing to keep.
 */
export function verdictInstructionBlock(input: VerdictBlockInput): string {
  const vocab = input.vocabulary ?? KLP_VERDICTS;
  const list = vocab.map((v) => `"${v}"`).join(', ');
  return `Choose exactly one verdict per key point from this vocabulary: ${list}.

Use "correct" when the answer states the point or entails it unmistakably. Use "omission" when the point is never mentioned at all — a hole. Use "contradicted" when the answer asserts the opposite or a false version of it — a wrong model; these two are different failures and must not be confused. Use "inversion" when a direction or cause-and-effect is reversed; "conflation" when the right idea appears under the wrong name or two points are merged; "misapplication" when the point is applied outside its conditions; "incomplete" when it is named but not explained. "partial" and "failed" are honest fallbacks when nothing more specific fits — do not force a specific label.

For every verdict other than "correct", include "quote": a VERBATIM excerpt of the answer (at most 20 words, copied exactly, no paraphrase) that decided the verdict; for "omission" quote the closest thing the answer says, or omit the field if nothing is relevant. Omit "quote" on "correct".${input.strict ? `\n\n${STRICT_GRADING_CLAUSE}${input.showKinds ? `\n\n${KIND_STRICTNESS_CLAUSE}` : ''}\n\n${SUBSTANCE_FLOOR_CLAUSE}` : ''}`;
}
