import { GamePiecesSchema } from '@/lib/ai/schemas';
import { MAX_ANSWER_WORDS } from '@/lib/games/pieces';

export interface MakeGamePiecesBuildInput {
  /** Cards with their live key points, batched. `ref` is a prompt-local index. */
  cards: { ref: number; term: string; definition: string; klps: { ref: number; text: string }[] }[];
}

/**
 * Turn key points into game pieces: a short cloze prompt with ONE blank and
 * a 1–4 word answer, or nothing when the point has no clean short answer.
 *
 * The output vocabulary is named in the prompt because TypeScript drops what
 * the model was never told about (`acceptCloze` validates blank count and
 * word cap and DROPS, never repairs). "Nothing" is a real, correct output —
 * most pure-mechanism sentences have no short answer, and a bad piece is
 * worse than none.
 */
export const MAKE_GAME_PIECES_PROMPT = {
  id: 'make-game-pieces',
  version: 1,
  schema: GamePiecesSchema,

  build(input: MakeGamePiecesBuildInput): string {
    const cards = input.cards
      .map(
        (c) =>
          `Card ${c.ref}: ${c.term}\n${c.definition}\nKey points:\n${c.klps.map((k) => `  [${k.ref}] ${k.text}`).join('\n')}`,
      )
      .join('\n\n');

    return `You are making short quiz pieces for fast games (a falling-block game and a crossword) from the key points of flashcards.

For EACH key point, decide whether it has a clean, short answer — a name, a term, a number, a one-to-${MAX_ANSWER_WORDS}-word phrase — that a learner could type or pick from tiles. If it does, write ONE piece:
- "prompt": the key point rewritten as a sentence with exactly one blank, written as three underscores ___ , that the answer fills. The prompt must not contain the answer or an obvious synonym of it. Keep it under 15 words.
- "answer": the words that fill the blank, ${MAX_ANSWER_WORDS} words at most.
- "aliases": other spellings or forms you would accept as correct (abbreviations, singular/plural), possibly empty.

If a key point has NO clean short answer — it is a mechanism, a condition, a comparison that only makes sense as a sentence — return nothing for it. Returning nothing is correct and expected for most mechanism points. Never force a blank onto a sentence that does not have a natural one.

Examples of good pieces:
- "WACC stands for ___" → "weighted average cost of capital" (aliases: [])
- "A rise in working capital is a ___ of cash" → "use" (aliases: ["use of cash"])
- "Depreciation is added back to net income because it is ___" → "non-cash" (aliases: ["a non-cash expense", "non cash"])

${cards}

Output JSON:
{ "pieces": [ { "cardRef": number, "klpRef": number, "prompt": string, "answer": string, "aliases": string[] } ] }

Include only the key points that produced a piece. At most one piece per key point.`;
  },
};
