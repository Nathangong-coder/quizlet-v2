import { CandidateGradeSchema } from '@/lib/ai/schemas';
import { verdictInstructionBlock } from './verdict-block';

/**
 * The strict clause, the relaxed kinds and the kind clause moved INTO
 * `verdict-block.ts` (Spec 5 Phase A) so the shared block can carry them
 * without importing this module back. Re-exported here so every existing
 * importer keeps working.
 */
export { STRICT_GRADING_CLAUSE, RELAXED_KINDS, KIND_STRICTNESS_CLAUSE } from './verdict-block';

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
/**
 * v4 (Spec 5 Phase A, 2026-09-17): the verdict paragraph — vocabulary, per-
 * label guidance, quote rule, strict and kind clauses — is now
 * `verdictInstructionBlock` in `./verdict-block`, ONE wording shared with the
 * runtime and diagnostic graders. The vocabulary is listed quoted, and the
 * label guidance names omission vs contradicted as different failures. The
 * output line keeps its `evidence` field: authoring rows store `evidence`.
 * Its word cap is the block's 20 words (fix round: the line said 15 while
 * the block it points at said 20, and a grader given two caps picks one at
 * random); `CandidateGradeSchema` bridges a `quote` key into `evidence`
 * either way, so a model that followed the block's word loses nothing.
 */
export const GRADE_CANDIDATE_PROMPT = {
  id: 'grade-candidate',
  version: 4,
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

For each KLP, decide whether the candidate's answer supports it. ${verdictInstructionBlock({ strict: !!input.strict, showKinds })}

Output JSON:
{ "verdicts": [ { "klpIndex": number, "verdict": string, "evidence": string } ] }
One entry per KLP, referencing it by its [index]. "evidence" carries the quote asked for above: a VERBATIM excerpt (at most 20 words, copied exactly) of what in the answer decided the verdict; OMIT it entirely when the verdict is "correct".

Question: ${input.question}

Key Learning Points:
${klps}

${referenceBlock}Candidate's answer:
${input.candidateAnswer}`;
  },
};
