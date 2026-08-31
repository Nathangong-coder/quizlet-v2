import {
  DiagnosticGradeSetSchema,
  DiagnosticQuestionSetSchema,
  DiagnosticReportSchema,
} from '@/lib/ai/schemas';

export interface DiagnosticCardPromptInput {
  ref: number;
  term: string;
  definition: string;
}

export interface DiagnosticQuestionsBuildInput {
  setTitle: string;
  questionCount: number;
  cards: DiagnosticCardPromptInput[];
}

export interface DiagnosticGradingBuildInput {
  questions: Array<{ ref: number; question: string; expectedAnswer: string; learningPoint: string; answer: string }>;
}

export interface DiagnosticReportBuildInput {
  setTitle: string;
  results: Array<{ question: string; learningPoint: string; answer: string; score: number; status: string; mistake?: string }>;
}

export const DIAGNOSTIC_QUESTIONS_PROMPT = {
  id: 'diagnostic-questions',
  version: 1,
  schema: DiagnosticQuestionSetSchema,
  build(input: DiagnosticQuestionsBuildInput): string {
    return `You are designing a rigorous diagnostic test for ${input.setTitle}.

Create exactly ${input.questionCount} open-ended questions from the study set below. The goal is reliable diagnosis, not a fun quiz: cover as many distinct learning points as possible, include at least two follow-up questions, and test definitions, mechanisms, comparisons, and application when the source supports them.

Rules:
- Each question must have one clear expected answer.
- Every question must reference a valid cardRef from the supplied cards.
- A follow-up should probe a likely misunderstanding or ask the learner to apply the same learning point.
- Do not invent facts outside the supplied cards.
- Return structured JSON with a questions array. Use kind core or follow-up.

Study set cards:
${input.cards.map((card) => `[${card.ref}] Term: ${card.term}\nDefinition: ${card.definition}`).join('\n\n')}`;
  },
};

export const DIAGNOSTIC_GRADING_PROMPT = {
  id: 'diagnostic-grading',
  version: 1,
  schema: DiagnosticGradeSetSchema,
  build(input: DiagnosticGradingBuildInput): string {
    return `Grade every diagnostic response against its expected answer and learning point.

Use score 1-10: mastered means 8-10, partial means 5-7, missed means 1-4. Identify the specific misconception or omission when the answer is partial or missed. Do not reward an answer that merely repeats the question. Return exactly one grade per questionRef and do not invent missing responses.

Questions and responses:
${input.questions.map((item) => `[${item.ref}] Learning point: ${item.learningPoint}\nQuestion: ${item.question}\nExpected answer: ${item.expectedAnswer}\nLearner answer: ${item.answer || '[no answer]'}`).join('\n\n')}`;
  },
};

export const DIAGNOSTIC_REPORT_PROMPT = {
  id: 'diagnostic-report',
  version: 1,
  schema: DiagnosticReportSchema,
  build(input: DiagnosticReportBuildInput): string {
    return `Turn the completed diagnostic test for ${input.setTitle} into an immediate learning plan.

Summarize what the learner knows, the highest-value gaps, and concrete next recommendations. Group repeated mistakes by learning point. Recommendations must be actionable inside a study app (review, rewrite, practice, or revisit a concept). Do not claim a gap without evidence in the results. Return structured JSON with overview, strengths, gaps, recommendations, and learningPoints.

Results:
${input.results.map((item) => `Learning point: ${item.learningPoint}\nQuestion: ${item.question}\nAnswer: ${item.answer || '[no answer]'}\nScore: ${item.score}/10 (${item.status})\nMistake: ${item.mistake || 'none noted'}`).join('\n\n')}`;
  },
};
