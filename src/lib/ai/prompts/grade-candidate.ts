import { CandidateGradeSchema } from '@/lib/ai/schemas';
import { KLP_VERDICTS } from '@/lib/klp/verdicts';

export interface GradeCandidateBuildInput {
  question: string;
  referenceAnswer: string;
  /**
   * `kind` is optional and only READ in strict mode, where it selects the
   * strictness the point is graded at. Shown beside the point when present.
   */
  klps: { text: string; kind?: string }[];
  candidateAnswer: string;
  /**
   * Adds the strict clause (2026-09-12, owner): credit a point only when the
   * answer states it explicitly; when in doubt, the lower verdict. Off by
   * default so every stored score stays comparable; a run that turns it on
   * says so in its model label.
   */
  strict?: boolean;
}

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
 * Call B of the authoring pipeline. ONE candidate answer per call — this is
 * THE ISOLATION RULE (design doc §1.1) and it is load-bearing for two
 * distinct reasons, not one:
 *
 * 1. A model that just authored both the KLPs and the wrong answers grades
 *    its own material generously. A lenient grader exits the discrimination
 *    loop early, producing loose KLPs that LOOK tested — worse than untested,
 *    because the flag says they passed.
 * 2. A grader shown all four candidates at once can RANK them against each
 *    other instead of judging each against the KLPs — handing the reference
 *    high marks and the wrong answers low ones BY COMPARISON. That
 *    manufactures separation the KLPs never earned, and the score would
 *    report success exactly when it was measuring nothing.
 *
 * So this prompt receives ONLY the question, the reference answer, the KLP
 * list, and ONE candidate answer. It must never say the candidate was
 * written to be wrong, never name an archetype, and never mention another
 * candidate — the grader's whole job is judging THIS answer against THESE
 * propositions, with no other context to lean on.
 *
 * ONE MORE CASE the isolation rule covers, found in review: grading the
 * REFERENCE candidate. `authorCard` calls this with
 * `candidateAnswer === referenceAnswer` once per card — the reference is
 * graded like any other candidate, in its own call. If the reference block
 * below were shown unconditionally, that call would contain the identical
 * text twice: once labelled "the strong reference answer" and once as "the
 * candidate's answer", which pre-tells the grader the text is the gold
 * standard before asking it to judge that same text. It would mark
 * everything "correct" by construction, `passesReference` (design §2's
 * FIRST condition — the reference must genuinely support a KLP, or the KLP
 * was hallucinated past its artifact) would never actually fail, and
 * `referenceScore` — half of `separation` — would be inflated on every
 * card. So the reference block is OMITTED entirely when the candidate being
 * graded IS the reference; the KLPs are judged directly against the same
 * text with no "here is the standard" framing to lean on.
 */
/**
 * v2 (2026-09-13) — the same judgment, laid out for the bill:
 *
 *  - PREFIX ORDER. Everything shared across a card's grading calls (question,
 *    key points, verdict vocabulary, strictness) comes FIRST and the candidate
 *    answer LAST, so DeepSeek's prefix cache hits on the whole shared part.
 *    A cache hit is billed at 1/50th of a miss; before this the candidate sat
 *    in the middle and nothing after it ever cached. The reference block sits
 *    just before the candidate, so the self-graded call (which omits it)
 *    still shares the prefix up to that point.
 *  - EVIDENCE ONLY WHERE IT SAYS SOMETHING. Output tokens are 4x the price
 *    of input and the grader's evidence strings were a third of a card's
 *    whole bill (docs/ai/model-performance.md, "What a card costs") while no
 *    computation reads them. A `correct` verdict now carries no evidence; the
 *    others carry one clause.
 */
export const GRADE_CANDIDATE_PROMPT = {
  id: 'grade-candidate',
  version: 3,
  schema: CandidateGradeSchema,

  build(input: GradeCandidateBuildInput): string {
    // Kinds are shown only in strict mode: outside it they would be noise the
    // stored (non-strict) scores were never graded with.
    const showKinds = !!input.strict && input.klps.some((k) => !!k.kind);
    const klps = input.klps.map((k, i) => `[${i}]${showKinds && k.kind ? ` (${k.kind})` : ''} ${k.text}`).join('\n');
    const gradingReferenceItself = input.candidateAnswer === input.referenceAnswer;

    const referenceBlock = gradingReferenceItself
      ? ''
      : `A strong reference answer, for context on what a complete response looks like (do not compare the candidate's WORDING against it — judge only whether the candidate's OWN claims satisfy each KLP below):
${input.referenceAnswer}

`;

    // PREFIX ORDER (v3, 2026-09-14): everything that is the same for every
    // card in the corpus comes first — role, vocabulary, rules, output
    // format, strictness — then the card, then the candidate. DeepSeek's
    // cache is a prefix cache in 64-token blocks, so this block now hits on
    // every grading call of every card, not only within one card.
    return `You are grading a candidate's answer to one interview question against a fixed list of Key Learning Points (KLPs). Judge only what this answer itself claims — you have no information about how it was produced.

For each KLP, decide whether the candidate's answer supports it. Choose exactly one verdict per KLP from this vocabulary:
${KLP_VERDICTS.join(', ')}

Use "correct" when the answer clearly states the point. Use "omission" when the point is never mentioned at all. Use "incomplete" when it is named but not actually explained. Use "contradicted" or one of the other specific labels above when the answer actively gets the point wrong in that particular way. When nothing more specific applies, "partial" or "failed" are honest fallbacks — do not force a specific label that does not fit.

Output JSON:
{ "verdicts": [ { "klpIndex": number, "verdict": string, "evidence": string } ] }
One entry per KLP, referencing it by its [index]. "evidence" is ONE short clause (at most 15 words) quoting or naming what in the answer decided the verdict; OMIT it entirely when the verdict is "correct".${input.strict ? `\n\n${STRICT_GRADING_CLAUSE}${showKinds ? `\n\n${KIND_STRICTNESS_CLAUSE}` : ''}` : ''}

Question: ${input.question}

Key Learning Points:
${klps}

${referenceBlock}Candidate's answer:
${input.candidateAnswer}`;
  },
};
