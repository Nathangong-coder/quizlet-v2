import {
  DiagnosticGradeSetSchema,
  DiagnosticQuestionSetSchema,
  DiagnosticReportSchema,
} from '@/lib/ai/schemas';
import {
  ACCURACY_TYPES,
  CLARITY_TYPES,
  CONCISENESS_TYPES,
  MAX_TAGS_PER_ANSWER,
} from '@/lib/errors/taxonomy';

export interface DiagnosticProbePromptInput {
  probeRef: number;
  kind: 'core' | 'follow-up';
  term: string;
  definition: string;
  /** `CardKlp.text` — the proposition this question must test, and only this. */
  keyPoint: string;
}

export interface DiagnosticQuestionsBuildInput {
  setTitle: string;
  probes: DiagnosticProbePromptInput[];
}

export interface DiagnosticGradingBuildInput {
  questions: Array<{
    ref: number;
    question: string;
    expectedAnswer: string;
    keyPoint: string;
    answer: string;
  }>;
}

export interface DiagnosticReportBuildInput {
  setTitle: string;
  results: Array<{
    question: string;
    keyPoint: string;
    answer: string;
    score: number;
    status: string;
    mistake?: string;
  }>;
}

/**
 * v2. The model is handed ONE key point per probe and writes one question for
 * it. It no longer chooses which card to test or invents a "learning point" —
 * both come from `selectDiagnosticProbes`, so every question is anchored to a
 * real `CardKlp` row and its result can be credited to that row.
 */
export const DIAGNOSTIC_QUESTIONS_PROMPT = {
  id: 'diagnostic-questions',
  version: 2,
  schema: DiagnosticQuestionSetSchema,
  build(input: DiagnosticQuestionsBuildInput): string {
    return `You are writing a rigorous diagnostic test for ${input.setTitle}.

Each numbered probe below names ONE key point the learner is supposed to hold. Write exactly one question per probe and return it with that probe's number.

Rules:
- The question must test THAT key point and nothing else. Do not widen it to cover the rest of the card.
- The expected answer must be answerable from the key point alone.
- Do not invent facts beyond the card text supplied.
- A probe marked follow-up asks the SAME key point from a different angle: make the learner apply it, or probe the misunderstanding someone who half-knows it would have. Do not simply rephrase the plain question.
- Return exactly one entry per probeRef. No extra entries, no missing entries.

Probes:
${input.probes.map((probe) => `[${probe.probeRef}] (${probe.kind})\nKey point: ${probe.keyPoint}\nFrom card — Term: ${probe.term}\nDefinition: ${probe.definition}`).join('\n\n')}`;
  },
};

/**
 * v2. Returns the same `klpResults`/`errorTags` contract short answer uses, so
 * credit and significance are computed in TypeScript by `buildAnalysisWrites`.
 *
 * The grader judges ONE key point per question — the one that question was
 * built from. It is never shown the card's other key points, because a grader
 * that can see them will credit them, and a verdict on a point the question
 * never asked about is a fabricated observation: once written it is
 * indistinguishable from a real one.
 *
 * THE ERROR-TYPE VOCABULARY IS SPELLED OUT, as it is in the short-answer
 * prompt. Left implicit, a real model invents its own words — a live probe on
 * gemini-3.6-flash returned `missing_response` and `incorrect_answer`, neither
 * of which is in `ACCURACY_TYPES`, so `buildAnalysisWrites` dropped EVERY tag
 * and three plainly wrong answers recorded zero errors. The closed vocabulary
 * is the whole reason error types can be aggregated at all; a grader that has
 * not been shown it cannot honour it.
 */
export const DIAGNOSTIC_GRADING_PROMPT = {
  id: 'diagnostic-grading',
  version: 2,
  schema: DiagnosticGradeSetSchema,
  build(input: DiagnosticGradingBuildInput): string {
    return `Grade every diagnostic response against its key point and expected answer.

Use score 1-10: mastered means 8-10, partial means 5-7, missed means 1-4. Identify the specific misconception or omission when the answer is partial or missed. Do not reward an answer that merely repeats the question. Return exactly one grade per questionRef and do not invent missing responses.

LENGTH LIMITS, and they are strict:
- "feedback": one or two sentences, 300 characters maximum.
- "mistake": ONE sentence naming the single specific misconception, 200 characters maximum. Omit the field entirely when the answer is correct.
- WITHIN a field, say each thing once: do not restate the question, and do not list the same omission phrased several ways. A blank or vague answer gets one short sentence, not a paragraph — it does not earn more words than a good answer.

These limits are about the length of each field. They are NOT permission to leave a question out. Grade EVERY questionRef separately, including when two answers are identical or equally poor — two identical answers get two identical grades, not one.

For EACH question also return:

"klpResults": exactly one entry, with klpRef 0, judging the key point that
  question tested.
  - "passed"  — the learner holds it
  - "partial" — mentioned but incomplete or imprecise
  - "failed"  — absent, or stated wrongly
  Judge ONLY that key point. You are not being asked about anything else the
  card teaches. Include a short verbatim "evidence" quote where one exists.

"errorTags": at most ${MAX_TAGS_PER_ANSWER} tags, at most 2 per dimension.
  Tag only what is genuinely wrong; a clean answer returns an empty list.

  dimension "accuracy"     — types: ${ACCURACY_TYPES.join(', ')}
  dimension "clarity"      — types: ${CLARITY_TYPES.join(', ')}
  dimension "conciseness"  — types: ${CONCISENESS_TYPES.join(', ')}

  Each tag needs:
  - "type" from that dimension's list. Use NO other word.
  - "klpRef" 0 when the error is about the key point; omit it when the error is
    about the whole answer.
  - "secondaryKlpRef" for "conflation" only: the point it was confused WITH.
  - "magnitude" 1-10, how severe THIS instance of that type is. Judge degree
    WITHIN the type you chose — do not use it to rank one type against another.
  - "quote": the span of the answer the tag refers to.

Questions and responses:
${input.questions.map((item) => `[${item.ref}] Key point [0]: ${item.keyPoint}\nQuestion: ${item.question}\nExpected answer: ${item.expectedAnswer}\nLearner answer: ${item.answer || '[no answer]'}`).join('\n\n')}`;
  },
};

/**
 * v2. Unchanged in shape; the results it summarises now carry real key-point
 * text rather than a phrase the generator made up.
 */
export const DIAGNOSTIC_REPORT_PROMPT = {
  id: 'diagnostic-report',
  version: 2,
  schema: DiagnosticReportSchema,
  build(input: DiagnosticReportBuildInput): string {
    return `Turn the completed diagnostic test for ${input.setTitle} into an immediate learning plan.

Summarize what the learner knows, the highest-value gaps, and concrete next recommendations. Group repeated mistakes by key point. Recommendations must be actionable inside a study app (review, rewrite, practice, or revisit a concept). Do not claim a gap without evidence in the results. Return structured JSON with overview, strengths, gaps, recommendations, and learningPoints.

Results:
${input.results.map((item) => `Key point: ${item.keyPoint}\nQuestion: ${item.question}\nAnswer: ${item.answer || '[no answer]'}\nScore: ${item.score}/10 (${item.status})\nMistake: ${item.mistake || 'none noted'}`).join('\n\n')}`;
  },
};
