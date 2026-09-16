import { describe, it, expect } from 'vitest'
import { rankScores, timeToScore, formatScore, isPlausibleScore, isGameMode, GAME_MODES, LEADERBOARD_SIZE, SCORE_BOUNDS } from '@/lib/games/scores'
import { PALETTE, compose, KNIGHT, KNIGHT_SHIELD, SLIME, IMP, DARK_KNIGHT, BOSS, MAGICIAN, HOST_BASE, FACES, COSTUMES } from '@/lib/games/sprites'
import { dealMatch, MATCH_PAIRS } from '@/lib/games/match-deal'
import { initMatchGame } from '@/lib/game/match'
import { mulberry32 } from '@/lib/games/rng'

const at = (s: number) => new Date(Date.UTC(2026, 8, 13, 0, 0, s))
const row = (userId: string, score: number, s = 0, handle: string | null = userId) => ({ userId, handle, score, createdAt: at(s) })

describe('leaderboard arithmetic', () => {
  it('keeps the best row per player, ranks higher-is-better, shares ranks on ties', () => {
    const ranked = rankScores([row('a', 10), row('a', 30, 1), row('b', 30, 2), row('c', 5), row('a', 20, 3)])
    expect(ranked.map((r) => [r.userId, r.score, r.rank])).toEqual([['a', 30, 1], ['b', 30, 1], ['c', 5, 3]])
  })

  it('a tie goes to the earlier run; handle-less rows are dropped; the board is capped', () => {
    const ranked = rankScores([row('late', 30, 5), row('early', 30, 1), row('ghost', 99, 0, null)])
    expect(ranked.map((r) => r.userId)).toEqual(['early', 'late'])
    const many = Array.from({ length: 40 }, (_, i) => row(`u${i}`, i))
    expect(rankScores(many)).toHaveLength(LEADERBOARD_SIZE)
    expect(rankScores(many, 3).map((r) => r.score)).toEqual([39, 38, 37])
  })

  it('times are stored negated so one DESC order serves every board, and read back as m:ss.t', () => {
    expect(timeToScore(61_234)).toBe(-61_234)
    expect(timeToScore(-5)).toBe(0)
    expect(formatScore('match', -61_234)).toBe('1:01.2')
    expect(formatScore('crossword', -600)).toBe('0:00.6')
    expect(formatScore('hot-seat', 72)).toBe('72 mood')
    expect(formatScore('blitz', 1234)).toBe('1234')
    // A faster time ranks first.
    expect(rankScores([row('slow', timeToScore(90_000)), row('fast', timeToScore(30_000))])[0].userId).toBe('fast')
  })

  it('bounds reject a tampered score; modes are a closed list per game', () => {
    expect(isPlausibleScore('hot-seat', 100)).toBe(true)
    expect(isPlausibleScore('hot-seat', 101)).toBe(false)
    expect(isPlausibleScore('match', 5)).toBe(false)
    expect(isPlausibleScore('match', -5)).toBe(true)
    expect(isPlausibleScore('blitz', 1.5)).toBe(false)
    expect(isPlausibleScore('gauntlet', SCORE_BOUNDS.gauntlet.max)).toBe(true)
    expect(isGameMode('gauntlet', 'mc')).toBe(true)
    expect(isGameMode('gauntlet', 'easy')).toBe(false)
    expect(isGameMode('tetris', 'default')).toBe(false)
    for (const modes of Object.values(GAME_MODES)) expect(modes.length).toBeGreaterThan(0)
  })
})

describe('pixel sprites', () => {
  const cast = { KNIGHT, KNIGHT_SHIELD, SLIME, IMP, DARK_KNIGHT, BOSS, MAGICIAN, HOST_BASE }

  it.each(Object.entries(cast))('%s is a rectangular grid of palette colours', (_name, sprite) => {
    const width = sprite[0].length
    for (const r of sprite) {
      expect(r.length).toBe(width)
      for (const ch of r) if (ch !== '.') expect(PALETTE[ch], `unknown colour ${ch}`).toBeDefined()
    }
  })

  it('every face and costume fits the host and uses palette colours', () => {
    for (const ov of [...Object.values(FACES), ...Object.values(COSTUMES).map((c) => c.overlay)]) {
      expect(ov.length).toBeLessThanOrEqual(HOST_BASE.length)
      for (const r of ov) {
        expect(r.length === 0 || r.length === HOST_BASE[0].length).toBe(true)
        for (const ch of r) if (ch !== '.') expect(PALETTE[ch]).toBeDefined()
      }
    }
    expect(COSTUMES.default).toBeDefined()
  })

  it('compose overlays opaque pixels and keeps the base under transparent ones', () => {
    expect(compose(['kk', 'kk'], ['.r', ''], null, ['', 'w.'])).toEqual(['kr', 'wk'])
    // An overlay larger than the base is clipped, never widens it.
    expect(compose(['k'], ['rr', 'rr'])).toEqual(['r'])
  })
})

describe('Match deals from pieces', () => {
  const pieces = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, prompt: `Prompt ${i}`, answer: `A${i}`, kind: 'cloze', cardId: `c${i}`, klpId: null, aliases: [], enabled: true }))

  it('deals exactly eight pairs, seeded, never a paragraph', () => {
    const a = dealMatch(pieces, 7)
    expect(a).toHaveLength(MATCH_PAIRS)
    expect(new Set(a.map((p) => p.id)).size).toBe(MATCH_PAIRS)
    expect(a).toEqual(dealMatch(pieces, 7))
    expect(a).not.toEqual(dealMatch(pieces, 8))
    expect(a[0]).toMatchObject({ term: expect.stringMatching(/^Prompt/), definition: expect.stringMatching(/^A/) })
  })

  it('a seeded board is identical on server and client — same tile ids, same order', () => {
    const cards = dealMatch(pieces, 3)
    const a = initMatchGame(cards, '3', mulberry32(3)).tiles
    const b = initMatchGame(cards, '3', mulberry32(3)).tiles
    expect(a).toEqual(b)
    expect(a).toHaveLength(16)
    expect(a.map((t) => t.id)).toContain(`${cards[0].id}:term`)
    // And not merely the input order.
    expect(a.map((t) => t.cardId + t.side)).not.toEqual(cards.flatMap((c) => [c.id + 'term', c.id + 'definition']))
  })

  it('a set with exactly eight pieces deals all of them', () => {
    expect(dealMatch(pieces.slice(0, 8), 1).map((p) => p.id).sort()).toEqual(pieces.slice(0, 8).map((p) => p.id).sort())
  })
})
