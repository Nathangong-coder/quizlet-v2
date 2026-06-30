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
    if (setup.starredOnly) {
      // Note: starred status is in CardProgress, this helper assumes we might pass it in or cards are pre-enriched
      // For now, if cards are just Card models, we can't check starred unless they have progress attached.
      // We'll assume 'card' objects passed here are enriched with { starred: boolean }
      if (!(card as any).starred) return false;
    }

    if (setup.failedOnly) {
      if (!isPreviouslyFailed(card.id, quizAnswers)) return false;
    }

    if (setup.categoryIds.length > 0) {
      const cardCategories = (card as any).categoryIds || [];
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
