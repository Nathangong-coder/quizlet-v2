import { CandidateGradeSchema } from '@/lib/ai/schemas';
import { KLP_VERDICTS } from '@/lib/klp/verdicts';

export interface GradeCandidateBuildInput {
  question: string;
  referenceAnswer: string;
  klps: { text: string }[];
  candidateAnswer: string;
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
 */
export const GRADE_CANDIDATE_PROMPT = {
  id: 'grade-candidate',
  version: 1,
  schema: CandidateGradeSchema,

  build(input: GradeCandidateBuildInput): string {
    const klps = input.klps.map((k, i) => `[${i}] ${k.text}`).join('\n');

    return `You are grading a candidate's answer to one interview question against a fixed list of Key Learning Points (KLPs). Judge only what this answer itself claims — you have no information about how it was produced.

Question: ${input.question}

A strong reference answer, for context on what a complete response looks like (do not compare the candidate's WORDING against it — judge only whether the candidate's OWN claims satisfy each KLP below):
${input.referenceAnswer}

Key Learning Points:
${klps}

Candidate's answer:
${input.candidateAnswer}

For each KLP above, decide whether the candidate's answer supports it. Choose exactly one verdict per KLP from this vocabulary:
${KLP_VERDICTS.join(', ')}

Use "correct" when the answer clearly states the point. Use "omission" when the point is never mentioned at all. Use "incomplete" when it is named but not actually explained. Use "contradicted" or one of the other specific labels above when the answer actively gets the point wrong in that particular way. When nothing more specific applies, "partial" or "failed" are honest fallbacks — do not force a specific label that does not fit.

Output JSON:
{ "verdicts": [ { "klpIndex": number, "verdict": string, "evidence": string } ] }
One entry per KLP, referencing it by its [index] above.`;
  },
};
