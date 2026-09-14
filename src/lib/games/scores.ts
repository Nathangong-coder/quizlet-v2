import type { GameId } from './pieces'

/**
 * Leaderboard arithmetic — pure. One convention for every board:
 * HIGHER IS BETTER, so a time-based game stores its time NEGATED (a faster
 * run is a larger number) and one `ORDER BY score DESC` serves all five.
 * `formatScore` turns it back into what a player reads.
 */

export const LEADERBOARD_SIZE = 20

export type GameMode =
  | { game: 'gauntlet'; mode: 'mc' | 'sa' }
  | { game: 'hot-seat'; mode: 'easy' | 'normal' | 'hard' }
  | { game: 'blitz'; mode: 'default' }
  | { game: 'crossword'; mode: 'default' }
  | { game: 'match'; mode: 'default' }

export const GAME_MODES: Record<GameId, readonly string[]> = {
  gauntlet: ['mc', 'sa'],
  'hot-seat': ['easy', 'normal', 'hard'],
  blitz: ['default'],
  crossword: ['default'],
  match: ['default'],
}

export function isGameMode(game: string, mode: string): game is GameId {
  return (GAME_MODES as Record<string, readonly string[]>)[game]?.includes(mode) ?? false
}

/** Time-based boards: store milliseconds negated. */
export function timeToScore(ms: number): number {
  return 0 - Math.max(0, Math.round(ms)) || 0 // `|| 0` folds -0 into 0
}

export function formatScore(game: GameId, score: number): string {
  if (game === 'crossword' || game === 'match') {
    const ms = -score
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const t = Math.floor((ms % 1000) / 100)
    return `${m}:${String(s).padStart(2, '0')}.${t}`
  }
  if (game === 'hot-seat') return `${score} mood`
  return String(score)
}

export interface ScoreRow {
  userId: string
  handle: string | null
  score: number
  createdAt: Date
  meta?: unknown
}

export interface RankedRow extends ScoreRow {
  rank: number
}

/**
 * Best row per player, ranked, ties sharing a rank, capped. Rows without a
 * handle are dropped here as a belt to the action's brace: a board ranks by
 * handle and an anonymous line is noise.
 */
export function rankScores(rows: readonly ScoreRow[], size = LEADERBOARD_SIZE): RankedRow[] {
  const best = new Map<string, ScoreRow>()
  for (const r of rows) {
    if (!r.handle) continue
    const cur = best.get(r.userId)
    if (!cur || r.score > cur.score || (r.score === cur.score && r.createdAt < cur.createdAt)) best.set(r.userId, r)
  }
  const sorted = [...best.values()].sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime())
  const out: RankedRow[] = []
  let rank = 0
  for (let i = 0; i < sorted.length && i < size; i++) {
    if (i === 0 || sorted[i].score !== sorted[i - 1].score) rank = i + 1
    out.push({ ...sorted[i], rank })
  }
  return out
}

/** Sanity bounds so a tampered client cannot post an absurd number. */
export const SCORE_BOUNDS: Record<GameId, { min: number; max: number }> = {
  gauntlet: { min: 0, max: 5000 },
  'hot-seat': { min: 0, max: 100 },
  blitz: { min: 0, max: 100000 },
  crossword: { min: -1000 * 60 * 60 * 3, max: 0 },
  match: { min: -1000 * 60 * 60, max: 0 },
}

export function isPlausibleScore(game: GameId, score: number): boolean {
  const b = SCORE_BOUNDS[game]
  return Number.isInteger(score) && score >= b.min && score <= b.max
}
