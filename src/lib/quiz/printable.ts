import { z } from "zod";

export function assemblePrintableQuiz(cards: any[], setup: any) {
  const prompts = cards.map((card) => {
    let prompt = "";
    if (setup.promptSide === "term") {
      prompt = card.term;
    } else if (setup.promptSide === "definition") {
      prompt = card.definition;
    } else {
      prompt = Math.random() > 0.5 ? card.term : card.definition;
    }
    return {
      id: card.id,
      prompt,
      answer: setup.promptSide === "term" ? card.definition : card.term,
    };
  });

  return {
    title: "Quiz",
    questions: prompts,
    setup,
  };
}
