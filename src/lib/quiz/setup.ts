import { z } from "zod";

export const QuizSetupSchema = z.object({
  questionMode: z.array(z.enum(["multiple-choice", "short-answer", "matching", "true-false"])).min(1),
  promptSide: z.enum(["term", "definition", "mixed"]),
  categoryIds: z.array(z.string()),
  starredOnly: z.boolean(),
  failedOnly: z.boolean(),
  printable: z.boolean(),
  questionCount: z.number().int().min(1),
});

export type QuizSetup = z.infer<typeof QuizSetupSchema>;

export function isPreviouslyFailed(cardId: string, quizAnswers: any[]) {
  return quizAnswers.some((ans) => ans.cardId === cardId && ans.isCorrect === false);
}

export function filterQuizCards(cards: any[], setup: QuizSetup, quizAnswers: any[] = []) {
  return cards.filter((card) => {
    if (!card) return false;

    if (setup.starredOnly) {
      if (card.starred === false || card.starred === undefined) return false;
    }

    if (setup.failedOnly) {
      if (!isPreviouslyFailed(card.id, quizAnswers)) return false;
    }

    if (setup.categoryIds && setup.categoryIds.length > 0) {
      const cardCategories = card.categoryIds || [];
      if (!setup.categoryIds.some((id) => cardCategories.includes(id))) return false;
    }

    return true;
  });
}

export function buildQuizPrompts(cards: any[], setup: QuizSetup) {
  return cards.map((card) => {
    let prompt = "";
    if (setup.promptSide === "term") {
      prompt = card.term;
    } else if (setup.promptSide === "definition") {
      prompt = card.definition;
    } else {
      // mixed: randomly choose
      prompt = Math.random() > 0.5 ? card.term : card.definition;
    }
    return {
      cardId: card.id,
      prompt,
    };
  });
}
