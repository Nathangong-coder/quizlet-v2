import { mulberry32, shuffle } from '@/lib/games/rng'
import type { GamePieceLike } from '@/lib/games/pieces'

/** Sixteen tiles on one screen: eight pairs, never more. */
export const MATCH_PAIRS = 8

/** Eight pieces, seeded, as term/definition pairs for the board. Pure. */
export function dealMatch(pieces: readonly GamePieceLike[], seed: number): { id: string; term: string; definition: string }[] {
  return shuffle(pieces, mulberry32(seed))
    .slice(0, MATCH_PAIRS)
    .map((p) => ({ id: p.id, term: p.prompt, definition: p.answer }))
}
