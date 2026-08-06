import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas';
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES, MAX_TAGS_PER_ANSWER } from '@/lib/errors/taxonomy';
import { learnerContextBlock } from './shared';
import { PromptKlp } from './multiple-choice';

export interface GradeShortAnswerBuildInput {
  card: Card;
  answer: string;
  profileBlock?: string;
  /** Live KLPs. Absent or empty falls back to the rubric-only prompt. */
  klps?: PromptKlp[];
}

export interface GradeShortAnswerBuildPartsInput {
  card: Card;
  promptBlocks: ContentBlock[];
  answer: string;
  profileBlock?: string;
  /** Live KLPs. Absent or empty falls back to the rubric-only prompt. */
  klps?: PromptKlp[];
}

const RUBRIC_BODY = `For each of the following categories, provide a score (1-10), a list of pros, and a list of cons:
1. Clarity: How easy is the answer to understand?
2. Conciseness: Does the answer avoid unnecessary filler?
3. Correctness: How accurate is the answer compared to the definition?

Additionally, provide:
- Overall Score: A final weighted grade (1-10).
- Summary: A concise synthesis of the performance.
- Suggested Improvement: A specific, actionable tip to make this answer "interview-ready".

Output the result as JSON.

JSON Schema:
{
  "clarity": { "score": number, "pros": string[], "cons": string[] },
  "conciseness": { "score": number, "pros": string[], "cons": string[] },
  "correctness": { "score": number, "pros": string[], "cons": string[] },
  "overall": number,
  "summary": string,
  "suggestedImprovement": string
}`;

/**
 * Appended when live KLPs are supplied. Asks for per-KLP outcomes and
 * closed-vocabulary error tags in the SAME call as the rubric — no second AI
 * call, no window where a grade exists without its analysis. `severity` is
 * the model's only numeric contribution; significance is computed in TS.
 */
const ANALYSIS_BODY = (klps: PromptKlp[]) => `
Key Learning Points this card teaches:
${klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n')}

Additionally return:

"klpResults": one entry per Key Learning Point above, judging ONLY that point:
  - "passed"  — the answer covers it correctly
  - "partial" — mentioned but incomplete or imprecise
  - "failed"  — absent, or stated wrongly
  Include a short verbatim "evidence" quote from the answer where one exists.
  Reference points by their [ref] number.

"errorTags": at most ${MAX_TAGS_PER_ANSWER} tags, at most 2 per dimension.
  Tag only what is genuinely wrong; a clean answer returns an empty list.

  dimension "accuracy"     — types: ${ACCURACY_TYPES.join(', ')}
  dimension "clarity"      — types: ${CLARITY_TYPES.join(', ')}
  dimension "conciseness"  — types: ${CONCISENESS_TYPES.join(', ')}

  Each tag needs:
  - "type" from that dimension's list. Use NO other word.
  - "klpRef" when the error is about a specific point; omit it when the error
    is about the whole answer.
  - "secondaryKlpRef" for "conflation" only: the point it was confused WITH.
  - "magnitude" 1-10, how severe THIS instance of that type is. 1 is a
    borderline case barely worth tagging; 10 is the most severe form of this
    error you could see. Judge degree WITHIN the type you chose — do not use
    it to rank one type against another.
  - "quote": the span of the answer the tag refers to.

Rank by what matters most. Do not pad to the cap.`;

/**
 * Short-answer grading prompt. Registry entry per Stage 6 Task 5 — routed
 * via task 'grade' in generateJson (strongest available flash). The rubric/schema is
 * unchanged from the pre-registry version: still 1-10
 * clarity/conciseness/correctness/overall. `profileBlock` only adds learner
 * context; it does not change what's being graded.
 *
 * v2 (Stage 8 Spec 2a): when live KLPs are supplied, the SAME call also
 * returns per-KLP outcomes and closed-vocabulary error tags (ANALYSIS_BODY).
 * Without KLPs the output is byte-identical to v1 — pre-existing tests and a
 * keyless user both depend on that.
 *
 * v3 (Stage 8 Spec 3): `severity` (absolute 1-5) is replaced by `magnitude`
 * (1-10, degree within the chosen type). The band table in TS converts it to
 * severity, which keeps the model out of cross-type ranking — a judgment it
 * has no stable anchor for.
 */
export const GRADE_SHORT_ANSWER_PROMPT = {
  id: 'grade-short-answer',
  version: 3,
  schema: ShortAnswerGradeSchema,

  build(input: GradeShortAnswerBuildInput): string {
    const analysis = input.klps && input.klps.length > 0 ? ANALYSIS_BODY(input.klps) : '';

    return `${learnerContextBlock(input.profileBlock)}You are a finance interview grader. Grade the following short-answer response.

Term: ${input.card.term}
Expected Definition: ${input.card.definition}
User Answer: "${input.answer}"

${RUBRIC_BODY}${analysis}`;
  },

  buildParts(input: GradeShortAnswerBuildPartsInput): { parts: any[]; promptText: string } {
    const analysis = input.klps && input.klps.length > 0 ? ANALYSIS_BODY(input.klps) : '';

    const promptText = `${learnerContextBlock(input.profileBlock)}You are a finance interview grader. Grade the following short-answer response.

${input.promptBlocks.some((b) => b.type !== 'text') ? '[The question material is shown above/below as images, audio, video, etc.]' : ''}

Expected Definition: ${input.card.definition}
User Answer: "${input.answer}"

${RUBRIC_BODY}${analysis}`;

    return { parts: [{ text: promptText }], promptText };
  },
};
