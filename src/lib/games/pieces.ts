/**
 * Game pieces — the pure half. Derivation rules, answer normalisation, and
 * the predicates the games use to decide what they can consume. No Prisma.
 * The database half (prepare, donors, persistence) is `src/actions/games.ts`.
 *
 * Design: docs/superpowers/specs/2026-09-13-learning-games-design.md §1.
 */

export const PIECE_KINDS = ['term', 'cloze'] as const
export type PieceKind = (typeof PIECE_KINDS)[number]

export interface GamePieceLike {
  id: string
  cardId: string
  klpId: string | null
  kind: string
  prompt: string
  answer: string
  aliases: string[]
  enabled: boolean
}

/** A card with ≤ 3 words of term and ≤ 12 of definition is already a piece. */
export const SHORT_TERM_WORDS = 3
export const SHORT_DEFINITION_WORDS = 12
/** A cloze answer is 1–5 words ("weighted average cost of capital" is five); longer is a sentence, not a piece. */
export const MAX_ANSWER_WORDS = 5

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

export function isShortCard(card: { term: string; definition: string }): boolean {
  return wordCount(card.term) <= SHORT_TERM_WORDS && wordCount(card.definition) <= SHORT_DEFINITION_WORDS
}

/** The deterministic `term` piece for a short card. No AI. */
export function termPiece(card: { term: string; definition: string }): { kind: 'term'; prompt: string; answer: string; aliases: string[] } {
  return { kind: 'term', prompt: card.definition.trim(), answer: card.term.trim(), aliases: [] }
}

/**
 * ONE normalisation for every typed comparison in every game: lowercase,
 * punctuation stripped, leading articles dropped, whitespace collapsed.
 */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
}

/** A typed answer matches a piece if it normalises to the answer or any alias. */
export function answerMatches(piece: { answer: string; aliases: string[] }, typed: string): boolean {
  const t = normalizeAnswer(typed)
  if (t.length === 0) return false
  return [piece.answer, ...piece.aliases].some((a) => normalizeAnswer(a) === t)
}

/**
 * Crossword needs a single run of 3–12 letters once spaces are removed —
 * multi-word answers are allowed (real crosswords drop the spaces), digits
 * and symbols are not.
 */
export function crosswordWord(answer: string): string | null {
  const w = normalizeAnswer(answer).replace(/\s+/g, '')
  return /^[a-z]{3,12}$/.test(w) ? w : null
}

export function isCrosswordSafe(piece: { answer: string }): boolean {
  return crosswordWord(piece.answer) !== null
}

/**
 * Validate a cloze the model returned for one KLP. Dropped, never repaired:
 * a prompt without exactly one blank, or an answer over the word cap, is a
 * bad piece and a bad piece is worse than none.
 */
export function acceptCloze(c: { prompt: string; answer: string; aliases?: string[] }): { kind: 'cloze'; prompt: string; answer: string; aliases: string[] } | null {
  const prompt = c.prompt.trim()
  const answer = c.answer.trim()
  if ((prompt.match(/___/g) ?? []).length !== 1) return null
  if (answer.length === 0 || wordCount(answer) > MAX_ANSWER_WORDS) return null
  if (normalizeAnswer(answer).length === 0) return null
  // The blank must not be answered by the prompt itself.
  if (normalizeAnswer(prompt).includes(normalizeAnswer(answer))) return null
  // Unique on the NORMALISED form, since that is what matching compares.
  const seen = new Set([normalizeAnswer(answer)])
  const aliases: string[] = []
  for (const raw of c.aliases ?? []) {
    const a = raw.trim()
    const k = normalizeAnswer(a)
    if (a.length === 0 || k.length === 0 || seen.has(k)) continue
    seen.add(k)
    aliases.push(a)
  }
  return { kind: 'cloze', prompt, answer, aliases }
}

/** Enabled pieces only, deduplicated on normalised answer so Blitz never shows two tiles that read the same. */
export function playablePieces<T extends GamePieceLike>(pieces: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const p of pieces) {
    if (!p.enabled) continue
    const key = normalizeAnswer(p.answer)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

// ---------------------------------------------------------------- availability

export const GAME_IDS = ['gauntlet', 'hot-seat', 'blitz', 'crossword', 'match'] as const
export type GameId = (typeof GAME_IDS)[number]

export const MIN_PIECES = { blitz: 8, crossword: 10, match: 6 } as const
export const MIN_READY_CARDS = 5

export type GameAvailability =
  | { state: 'playable' }
  | { state: 'needs_pieces'; short: number }
  | { state: 'no_klps'; short: number }
  | { state: 'sign_in' }

export function gameAvailability(input: {
  pieces: readonly GamePieceLike[]
  readyCards: number
  signedIn: boolean
}): Record<GameId, GameAvailability> {
  const playable = playablePieces(input.pieces)
  const crosswordSafe = playable.filter(isCrosswordSafe).length
  const need = (have: number, min: number): GameAvailability => (have >= min ? { state: 'playable' } : { state: 'needs_pieces', short: min - have })
  const cards: GameAvailability = !input.signedIn
    ? { state: 'sign_in' }
    : input.readyCards >= MIN_READY_CARDS
      ? { state: 'playable' }
      : { state: 'no_klps', short: MIN_READY_CARDS - input.readyCards }
  return {
    gauntlet: cards,
    'hot-seat': cards,
    blitz: need(playable.length, MIN_PIECES.blitz),
    crossword: need(crosswordSafe, MIN_PIECES.crossword),
    match: need(playable.length, MIN_PIECES.match),
  }
}
