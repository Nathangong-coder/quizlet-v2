import { Card } from '@prisma/client';

export const GRADING_RUBRIC = {
  clarity: 'How easy is the answer to understand? (1-10)',
  conciseness: 'Does the answer avoid unnecessary filler? (1-10)',
  correctness: 'How accurate is the answer compared to the definition? (1-10)',
  overall: 'Overall quality of the response. (1-10)',
};

export function buildMultipleChoicePrompt(card: Card, siblingCards: Card[]) {
  const siblings = siblingCards
    .filter(c => c.id !== card.id)
    .map(c => c.definition)
    .join('\\n- ');

  return `You are a finance interview expert. Generate a multiple-choice question for the following term.

Term: ${card.term}
Correct Definition: ${card.definition}

Other related definitions (use these as inspiration for plausible but incorrect distractors):
- ${siblings}

Requirements:
1. Provide exactly 4 options.
2. One option must be the exact correct definition.
3. The other 3 must be plausible but incorrect distractors.
4. Output the result as JSON.

JSON Schema:
{
  "options": string[],
  "correctAnswer": string
}`;
}

export function buildShortAnswerGradePrompt(card: Card, answer: string) {
  return `You are a finance interview grader. Grade the following short-answer response.

Term: ${card.term}
Expected Definition: ${card.definition}
User Answer: "${answer}"

For each of the following categories, provide a score (1-10), a list of pros, and a list of cons:
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
}

export interface TrainingPlanContext {
  weakCards: Card[];
  starredCards: Card[];
  confidenceEventsSummary: string;
  recentQuizAnswers: any[];
}

export function buildTrainingPlanPrompt(context: TrainingPlanContext) {
  const weakTerms = context.weakCards.map(c => c.term).join(', ');
  const starredTerms = context.starredCards.map(c => c.term).join(', ');

  return `You are an AI study coach. Create a personalized training plan based on the user's performance.

Weak terms (confidence <= 5): ${weakTerms}
Starred terms: ${starredTerms}
Confidence history summary: ${context.confidenceEventsSummary}
Recent quiz performance: ${JSON.stringify(context.recentQuizAnswers)}

Requirements:
1. Identify key focus areas with priority (low, medium, high).
2. Recommend specific cards for review.
3. Generate 3-5 new challenging short-answer questions targeting their weaknesses.
4. Output as JSON.

JSON Schema:
{
  "title": string,
  "summary": string,
  "focusAreas": [
    { "label": string, "reason": string, "priority": "low" | "medium" | "high" }
  ],
  "recommendedCardIds": string[],
  "generatedQuestions": [
    { "cardId": string | null, "question": string, "expectedAnswer": string }
  ]
}`;
}

export function buildMultipleChoiceGradePrompt(card: Card, selected: string, correct: string) {
  return `You are a finance interview grader. A user answered a multiple-choice question.

Term: ${card.term}
Correct Definition: ${correct}
User's Selected Option: ${selected}

If the answer is correct, provide a brief confirmation and a "pro tip" to deepen their understanding.
If the answer is incorrect, explain WHY it is wrong and why the correct answer is the right one.

Keep it concise (1-2 sentences).
Output as JSON: { "feedback": string }`;
}
