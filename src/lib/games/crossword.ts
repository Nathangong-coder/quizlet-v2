import { mulberry32, shuffle } from './rng'
import { crosswordWord, isCrosswordSafe, normalizeAnswer, type GamePieceLike } from './pieces'

/**
 * Crossword — layout and play, on pieces. `layoutCrossword` is a greedy
 * placer: longest word first at the centre, then each next word at the
 * crossing that maximises intersections without creating an adjacent
 * parallel run; up to GRID×GRID; three seeded attempts before giving up.
 *
 * Design: docs/superpowers/specs/2026-09-13-learning-games-design.md §2.4.
 */

export const GRID = 15
export const MIN_WORDS = 10
export const MAX_WORDS = 20
export const LAYOUT_ATTEMPTS = 3
export const REVEAL_PENALTY_MS = 30000

export type Dir = 'across' | 'down'

export interface Placed {
  pieceId: string
  word: string
  row: number
  col: number
  dir: Dir
  /** Clue number, assigned after placement in reading order. */
  number: number
}

export interface Crossword {
  size: number
  grid: (string | null)[][]
  words: Placed[]
  clues: { across: { number: number; pieceId: string; prompt: string; length: number }[]; down: { number: number; pieceId: string; prompt: string; length: number }[] }
}

type Cell = string | null

function emptyGrid(n: number): Cell[][] {
  return Array.from({ length: n }, () => Array<Cell>(n).fill(null))
}

function cellAt(g: Cell[][], r: number, c: number): Cell | undefined {
  if (r < 0 || c < 0 || r >= g.length || c >= g.length) return undefined
  return g[r][c]
}

/**
 * Can `word` sit at (row,col,dir)? Every cell must be empty or already hold
 * the same letter; the cells before and after the word must be empty; and
 * any cell perpendicular to a NEWLY written letter must be empty (no
 * adjacent parallel runs). Returns the number of intersections, or -1.
 */
function fits(g: Cell[][], word: string, row: number, col: number, dir: Dir): number {
  const n = g.length
  const dr = dir === 'down' ? 1 : 0
  const dc = dir === 'across' ? 1 : 0
  const endR = row + dr * (word.length - 1)
  const endC = col + dc * (word.length - 1)
  if (row < 0 || col < 0 || endR >= n || endC >= n) return -1
  // Cells before and after.
  if (cellAt(g, row - dr, col - dc)) return -1
  if (cellAt(g, endR + dr, endC + dc)) return -1
  let crossings = 0
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i
    const c = col + dc * i
    const existing = g[r][c]
    if (existing !== null) {
      if (existing !== word[i]) return -1
      crossings++
      continue
    }
    // New letter: neighbours perpendicular to the word must be empty.
    if (dir === 'across') {
      if (cellAt(g, r - 1, c) || cellAt(g, r + 1, c)) return -1
    } else {
      if (cellAt(g, r, c - 1) || cellAt(g, r, c + 1)) return -1
    }
  }
  return crossings
}

function write(g: Cell[][], word: string, row: number, col: number, dir: Dir): void {
  for (let i = 0; i < word.length; i++) {
    if (dir === 'across') g[row][col + i] = word[i]
    else g[row + i][col] = word[i]
  }
}

function attempt(items: { pieceId: string; word: string; prompt: string }[]): { grid: Cell[][]; placed: Omit<Placed, 'number'>[] } {
  const g = emptyGrid(GRID)
  const placed: Omit<Placed, 'number'>[] = []
  const first = items[0]
  const row = Math.floor(GRID / 2)
  const col = Math.floor((GRID - first.word.length) / 2)
  write(g, first.word, row, col, 'across')
  placed.push({ pieceId: first.pieceId, word: first.word, row, col, dir: 'across' })

  for (const item of items.slice(1)) {
    let best: { row: number; col: number; dir: Dir; score: number } | null = null
    // Try every letter of the candidate against every matching letter on the board.
    for (const p of placed) {
      for (let pi = 0; pi < p.word.length; pi++) {
        for (let wi = 0; wi < item.word.length; wi++) {
          if (p.word[pi] !== item.word[wi]) continue
          const dir: Dir = p.dir === 'across' ? 'down' : 'across'
          const pr = p.row + (p.dir === 'down' ? pi : 0)
          const pc = p.col + (p.dir === 'across' ? pi : 0)
          const r = dir === 'down' ? pr - wi : pr
          const c = dir === 'across' ? pc - wi : pc
          const score = fits(g, item.word, r, c, dir)
          if (score > 0 && (!best || score > best.score)) best = { row: r, col: c, dir, score }
        }
      }
    }
    if (!best) continue
    write(g, item.word, best.row, best.col, best.dir)
    placed.push({ pieceId: item.pieceId, word: item.word, row: best.row, col: best.col, dir: best.dir })
  }
  return { grid: g, placed }
}

/** Trim the grid to the bounding box of the placed letters, re-basing coordinates. */
function trim(grid: Cell[][], placed: Omit<Placed, 'number'>[]): { grid: Cell[][]; placed: Omit<Placed, 'number'>[]; size: number } {
  let minR = GRID, minC = GRID, maxR = -1, maxC = -1
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (grid[r][c]) { minR = Math.min(minR, r); minC = Math.min(minC, c); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c) }
  const size = Math.max(maxR - minR, maxC - minC) + 1
  const g = emptyGrid(size)
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) g[r][c] = cellAt(grid, minR + r, minC + c) ?? null
  return { grid: g, size, placed: placed.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC })) }
}

export function layoutCrossword(pieces: readonly GamePieceLike[], seed: number): Crossword | null {
  const safe = pieces.filter((p) => p.enabled && isCrosswordSafe(p))
  // Dedupe on the grid word — two pieces answering "use" would collide.
  const seen = new Set<string>()
  const items = safe
    .map((p) => ({ pieceId: p.id, word: crosswordWord(p.answer)!, prompt: p.prompt }))
    .filter((it) => (seen.has(it.word) ? false : (seen.add(it.word), true)))
  if (items.length < MIN_WORDS) return null

  let best: { grid: Cell[][]; placed: Omit<Placed, 'number'>[] } | null = null
  for (let k = 0; k < LAYOUT_ATTEMPTS; k++) {
    const rng = mulberry32(seed + k)
    // Longest first, the rest shuffled so retries differ.
    const shuffled = shuffle(items, rng).slice(0, MAX_WORDS).sort((a, b) => b.word.length - a.word.length)
    const result = attempt(shuffled)
    if (!best || result.placed.length > best.placed.length) best = result
    if (best.placed.length >= Math.min(MAX_WORDS, items.length)) break
  }
  if (!best || best.placed.length < MIN_WORDS) return null

  const t = trim(best.grid, best.placed)
  // Number in reading order: a cell starting both an across and a down word shares a number.
  const starts = new Map<string, number>()
  let n = 0
  const ordered = [...t.placed].sort((a, b) => a.row - b.row || a.col - b.col)
  const words: Placed[] = []
  for (const p of ordered) {
    const key = `${p.row},${p.col}`
    if (!starts.has(key)) starts.set(key, ++n)
    words.push({ ...p, number: starts.get(key)! })
  }
  const promptOf = new Map(items.map((it) => [it.pieceId, it.prompt]))
  const clue = (p: Placed) => ({ number: p.number, pieceId: p.pieceId, prompt: promptOf.get(p.pieceId)!, length: p.word.length })
  return {
    size: t.size,
    grid: t.grid,
    words,
    clues: {
      across: words.filter((w) => w.dir === 'across').sort((a, b) => a.number - b.number).map(clue),
      down: words.filter((w) => w.dir === 'down').sort((a, b) => a.number - b.number).map(clue),
    },
  }
}

// --------------------------------------------------------------------- play

export interface CrosswordState {
  puzzle: Crossword
  /** What the learner has typed, by "r,c". */
  entries: Record<string, string>
  /** Cells the learner asked to check that were wrong, by "r,c". Cleared on edit. */
  wrong: Record<string, true>
  /** Cells revealed, by "r,c". */
  revealed: Record<string, true>
  penaltyMs: number
  cursor: { row: number; col: number; dir: Dir } | null
  startedAt: number
  solvedAt: number | null
}

export type CrosswordAction =
  | { type: 'select'; row: number; col: number }
  | { type: 'toggle-dir' }
  | { type: 'type'; letter: string; now: number }
  | { type: 'erase' }
  | { type: 'move'; dr: number; dc: number }
  | { type: 'check' }
  | { type: 'reveal-word'; now: number }

const key = (r: number, c: number) => `${r},${c}`

export function createCrossword(puzzle: Crossword, now: number): CrosswordState {
  const first = puzzle.words[0]
  return { puzzle, entries: {}, wrong: {}, revealed: {}, penaltyMs: 0, cursor: first ? { row: first.row, col: first.col, dir: first.dir } : null, startedAt: now, solvedAt: null }
}

export function wordAt(p: Crossword, row: number, col: number, dir: Dir): Placed | null {
  return (
    p.words.find((w) => w.dir === dir && (dir === 'across' ? w.row === row && col >= w.col && col < w.col + w.word.length : w.col === col && row >= w.row && row < w.row + w.word.length)) ?? null
  )
}

export function isWordSolved(s: CrosswordState, w: Placed): boolean {
  for (let i = 0; i < w.word.length; i++) {
    const r = w.row + (w.dir === 'down' ? i : 0)
    const c = w.col + (w.dir === 'across' ? i : 0)
    if (normalizeAnswer(s.entries[key(r, c)] ?? '') !== w.word[i]) return false
  }
  return true
}

export function isSolved(s: CrosswordState): boolean {
  return s.puzzle.words.every((w) => isWordSolved(s, w))
}

function step(s: CrosswordState, forward: boolean): CrosswordState {
  if (!s.cursor) return s
  const { row, col, dir } = s.cursor
  const dr = dir === 'down' ? (forward ? 1 : -1) : 0
  const dc = dir === 'across' ? (forward ? 1 : -1) : 0
  const r = row + dr
  const c = col + dc
  if (cellAt(s.puzzle.grid, r, c)) return { ...s, cursor: { row: r, col: c, dir } }
  return s
}

export function reduceCrossword(s: CrosswordState, a: CrosswordAction): CrosswordState {
  if (s.solvedAt !== null) return s
  switch (a.type) {
    case 'select': {
      if (!s.puzzle.grid[a.row]?.[a.col]) return s
      // Clicking the selected cell flips direction; otherwise keep direction
      // if a word runs that way there, else switch.
      let dir: Dir = s.cursor?.dir ?? 'across'
      if (s.cursor && s.cursor.row === a.row && s.cursor.col === a.col) dir = dir === 'across' ? 'down' : 'across'
      if (!wordAt(s.puzzle, a.row, a.col, dir)) dir = dir === 'across' ? 'down' : 'across'
      return { ...s, cursor: { row: a.row, col: a.col, dir } }
    }
    case 'toggle-dir': {
      if (!s.cursor) return s
      const dir: Dir = s.cursor.dir === 'across' ? 'down' : 'across'
      return wordAt(s.puzzle, s.cursor.row, s.cursor.col, dir) ? { ...s, cursor: { ...s.cursor, dir } } : s
    }
    case 'type': {
      if (!s.cursor) return s
      const letter = a.letter.toLowerCase()
      if (!/^[a-z]$/.test(letter)) return s
      const k = key(s.cursor.row, s.cursor.col)
      if (s.revealed[k]) return step(s, true)
      const wrong = { ...s.wrong }
      delete wrong[k]
      const next = step({ ...s, entries: { ...s.entries, [k]: letter }, wrong }, true)
      return isSolved(next) ? { ...next, solvedAt: a.now } : next
    }
    case 'erase': {
      if (!s.cursor) return s
      const k = key(s.cursor.row, s.cursor.col)
      if (s.revealed[k]) return step(s, false)
      const entries = { ...s.entries }
      delete entries[k]
      const wrong = { ...s.wrong }
      delete wrong[k]
      return step({ ...s, entries, wrong }, false)
    }
    case 'move': {
      if (!s.cursor) return s
      const r = s.cursor.row + a.dr
      const c = s.cursor.col + a.dc
      if (!cellAt(s.puzzle.grid, r, c)) return s
      const dir: Dir = a.dr !== 0 ? 'down' : 'across'
      return { ...s, cursor: { row: r, col: c, dir: wordAt(s.puzzle, r, c, dir) ? dir : s.cursor.dir } }
    }
    case 'check': {
      const wrong: Record<string, true> = {}
      for (const [k, v] of Object.entries(s.entries)) {
        const [r, c] = k.split(',').map(Number)
        if (v && s.puzzle.grid[r][c] !== v) wrong[k] = true
      }
      return { ...s, wrong }
    }
    case 'reveal-word': {
      if (!s.cursor) return s
      const w = wordAt(s.puzzle, s.cursor.row, s.cursor.col, s.cursor.dir)
      if (!w) return s
      const entries = { ...s.entries }
      const revealed = { ...s.revealed }
      for (let i = 0; i < w.word.length; i++) {
        const k = key(w.row + (w.dir === 'down' ? i : 0), w.col + (w.dir === 'across' ? i : 0))
        entries[k] = w.word[i]
        revealed[k] = true
      }
      const next = { ...s, entries, revealed, wrong: {}, penaltyMs: s.penaltyMs + REVEAL_PENALTY_MS }
      return isSolved(next) ? { ...next, solvedAt: a.now } : next
    }
  }
}
