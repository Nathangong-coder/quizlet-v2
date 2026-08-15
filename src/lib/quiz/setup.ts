import { z } from "zod";
import { filterCardsByCategories } from "@/lib/cards/categories";

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
  const base = cards.filter((card) => {
    if (!card) return false;
    if (setup.starredOnly && (card.starred === false || card.starred === undefined)) return false;
    if (setup.failedOnly && !isPreviouslyFailed(card.id, quizAnswers)) return false;
    return true;
  });
  return filterCardsByCategories(base, setup.categoryIds);
}

/**
 * Spec 3C §6.5. Turn the learner's saved study scope into quiz setup's initial
 * category selection for ONE set.
 *
 * A resolve, not a copy: `QuizSetup.categoryIds` holds per-set `CardCategory`
 * ids, while the scope stores cross-set `normalizedName`s — a set-scoped row
 * cannot be named by an id that means something in another set.
 *
 * A PREFILL, never a filter (spec §6.2). A hard filter would drop a card the
 * learner explicitly selected here, which reads as a bug rather than a policy,
 * and the per-quiz category picker from Stage 3.6 would then be lying about
 * what it controls.
 */
export function resolveScopePrefill(input: {
  setId: string;
  scope: { setIds: string[]; categoryKeys: string[] };
  categories: { id: string; normalizedName: string }[];
}): { categoryIds: string[]; outOfScope: boolean } {
  const { setId, scope, categories } = input;

  // An empty `setIds` means every set, so only a NON-EMPTY list can exclude one.
  if (scope.setIds.length > 0 && !scope.setIds.includes(setId)) {
    // Prefill nothing and let the caller say why. Silently prefilling a set the
    // learner excluded is confusing; silently blocking it would be enforcement.
    return { categoryIds: [], outOfScope: true };
  }

  const wanted = new Set(scope.categoryKeys);
  // An empty result means "everything in this set", which is the existing
  // behaviour and the right default. Never prefill an empty-but-active filter:
  // that selects zero cards and produces a quiz with no questions.
  return {
    categoryIds: categories.filter((c) => wanted.has(c.normalizedName)).map((c) => c.id),
    outOfScope: false,
  };
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
