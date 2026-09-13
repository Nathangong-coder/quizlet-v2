import { describe, it, expect } from 'vitest'
import {
  isShortCard,
  termPiece,
  normalizeAnswer,
  answerMatches,
  isCrosswordSafe,
  crosswordWord,
  acceptCloze,
  playablePieces,
  gameAvailability,
  MIN_PIECES,
  MIN_READY_CARDS,
} from '@/lib/games/pieces'

const piece = (id: string, answer: string, extra: Partial<{ enabled: boolean; aliases: string[] }> = {}) => ({
  id, cardId: 'c', klpId: null, kind: 'cloze', prompt: `${id} ___`, answer, aliases: extra.aliases ?? [], enabled: extra.enabled ?? true,
})

describe('derivation', () => {
  it('a short card is a term piece with no AI', () => {
    const card = { term: 'WACC', definition: 'Weighted average cost of capital.' }
    expect(isShortCard(card)).toBe(true)
    expect(termPiece(card)).toEqual({ kind: 'term', prompt: 'Weighted average cost of capital.', answer: 'WACC', aliases: [] })
    expect(isShortCard({ term: 'Walk me through a DCF', definition: 'x' })).toBe(false)
    expect(isShortCard({ term: 'x', definition: 'one two three four five six seven eight nine ten eleven twelve thirteen' })).toBe(false)
  })

  it('accepts a cloze with exactly one blank and a short answer, and drops the rest', () => {
    expect(acceptCloze({ prompt: 'WACC stands for ___', answer: 'weighted average cost of capital', aliases: ['WACC', ' wacc ', 'Weighted Average Cost Of Capital'] })).toEqual({
      kind: 'cloze', prompt: 'WACC stands for ___', answer: 'weighted average cost of capital', aliases: ['WACC'],
    })
    // No blank, two blanks, answer too long, answer inside the prompt: all dropped.
    expect(acceptCloze({ prompt: 'No blank here', answer: 'x' })).toBeNull()
    expect(acceptCloze({ prompt: '___ and ___', answer: 'x' })).toBeNull()
    expect(acceptCloze({ prompt: 'A ___', answer: 'one two three four five six' })).toBeNull()
    expect(acceptCloze({ prompt: 'Cash is a use of ___ cash', answer: 'cash' })).toBeNull()
  })
})

describe('matching', () => {
  it('normalises case, punctuation, articles and whitespace', () => {
    expect(normalizeAnswer('  The Weighted-Average   Cost, of Capital! ')).toBe('weighted average cost of capital')
    expect(answerMatches({ answer: 'use', aliases: ['use of cash'] }, 'A USE OF CASH.')).toBe(true)
    expect(answerMatches({ answer: 'use', aliases: [] }, 'source')).toBe(false)
    expect(answerMatches({ answer: 'use', aliases: [] }, '   ')).toBe(false)
  })

  it('crossword-safe means 3-12 letters once spaces are removed', () => {
    expect(crosswordWord('net debt')).toBe('netdebt')
    expect(isCrosswordSafe({ answer: 'use' })).toBe(true)
    expect(isCrosswordSafe({ answer: 'no' })).toBe(false)
    expect(isCrosswordSafe({ answer: 'weighted average cost of capital' })).toBe(false)
    expect(isCrosswordSafe({ answer: '2x' })).toBe(false)
  })
})

describe('playablePieces', () => {
  it('drops disabled pieces and duplicates on normalised answer', () => {
    const out = playablePieces([piece('a', 'Use'), piece('b', 'use', { enabled: false }), piece('c', 'the use'), piece('d', 'source')])
    expect(out.map((p) => p.id)).toEqual(['a', 'd'])
  })
})

describe('gameAvailability', () => {
  const many = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => piece(`${prefix}${i}`, `word${'abcdefghijklmnopqrstuvwxyz'[i]}`))

  it('reports how many pieces short each piece game is', () => {
    const a = gameAvailability({ pieces: many(4), readyCards: 10, signedIn: true })
    expect(a.blitz).toEqual({ state: 'needs_pieces', short: MIN_PIECES.blitz - 4 })
    expect(a.match).toEqual({ state: 'needs_pieces', short: MIN_PIECES.match - 4 })
    expect(a.crossword).toEqual({ state: 'needs_pieces', short: MIN_PIECES.crossword - 4 })
    expect(gameAvailability({ pieces: many(12), readyCards: 10, signedIn: true }).blitz).toEqual({ state: 'playable' })
  })

  it('crossword counts only crossword-safe pieces', () => {
    const pieces = [...many(6), ...Array.from({ length: 6 }, (_, i) => piece(`long${i}`, `one two three four ${i}`))]
    const a = gameAvailability({ pieces, readyCards: 10, signedIn: true })
    expect(a.blitz).toEqual({ state: 'playable' })
    expect(a.crossword).toEqual({ state: 'needs_pieces', short: MIN_PIECES.crossword - 6 })
  })

  it('card games need sign-in first, then enough ready cards', () => {
    expect(gameAvailability({ pieces: [], readyCards: 10, signedIn: false }).gauntlet).toEqual({ state: 'sign_in' })
    expect(gameAvailability({ pieces: [], readyCards: 2, signedIn: true })['hot-seat']).toEqual({ state: 'no_klps', short: MIN_READY_CARDS - 2 })
    expect(gameAvailability({ pieces: [], readyCards: 5, signedIn: true }).gauntlet).toEqual({ state: 'playable' })
  })
})
