import { mulberry32, shuffle, type Rng } from './rng'
import { normalizeAnswer, type GamePieceLike } from './pieces'

/**
 * Blitz — the arcade game on pieces. Tick-driven: the component sends
 * `{ type: 'tick', now }` on every animation frame and the reducer owns
 * every timer, so the whole game runs under fake time in tests.
 *
 * Design: docs/superpowers/specs/2026-09-13-learning-games-design.md §2.3.
 */

export const LANES = 4
export const FALL_START_MS = 6000
export const FALL_FLOOR_MS = 2200
export const FALL_RAMP = 0.94
export const RAMP_EVERY = 5
export const WRONG_TAP_REMAINING = 0.3
export const STRIKES = 3
export const COMBO_AT = 3
export const FREEZE_MS = 1500
export const POINTS = 10
/** Gap between spawns, so lanes fill one at a time. */
export const SPAWN_GAP_MS = 1400

export interface FallingBlock {
  id: number
  pieceId: string
  lane: number
  prompt: string
  spawnedAt: number
  landsAt: number
}

export interface BlitzState {
  pieces: GamePieceLike[]
  order: string[]
  nextPieceIndex: number
  blocks: FallingBlock[]
  /** Tiles for the OLDEST block (the one about to land). */
  tiles: string[]
  targetBlockId: number | null
  score: number
  combo: number
  consecutive: number
  clears: number
  strikes: number
  fallMs: number
  frozenUntil: number
  lastSpawnAt: number
  nextBlockId: number
  status: 'playing' | 'over'
  startedAt: number
  endedAt: number | null
  seed: number
}

export type BlitzAction = { type: 'tick'; now: number } | { type: 'tap'; tile: string; now: number }

export function createBlitz(pieces: readonly GamePieceLike[], seed: number, now: number): BlitzState {
  const rng = mulberry32(seed)
  const order = shuffle(pieces.map((p) => p.id), rng)
  return {
    pieces: [...pieces],
    order,
    nextPieceIndex: 0,
    blocks: [],
    tiles: [],
    targetBlockId: null,
    score: 0,
    combo: 1,
    consecutive: 0,
    clears: 0,
    strikes: 0,
    fallMs: FALL_START_MS,
    frozenUntil: 0,
    lastSpawnAt: now - SPAWN_GAP_MS,
    nextBlockId: 1,
    status: pieces.length === 0 ? 'over' : 'playing',
    startedAt: now,
    endedAt: pieces.length === 0 ? now : null,
    seed,
  }
}

function pieceById(s: BlitzState, id: string): GamePieceLike {
  return s.pieces.find((p) => p.id === id)!
}

/** The correct answer plus three others whose normalised answers differ. */
export function tilesFor(s: BlitzState, pieceId: string, rng: Rng): string[] {
  const target = pieceById(s, pieceId)
  const seen = new Set([normalizeAnswer(target.answer)])
  const others: string[] = []
  for (const p of shuffle(s.pieces, rng)) {
    const key = normalizeAnswer(p.answer)
    if (seen.has(key)) continue
    seen.add(key)
    others.push(p.answer)
    if (others.length === 3) break
  }
  return shuffle([target.answer, ...others], rng)
}

function retarget(s: BlitzState, rng: Rng): BlitzState {
  const oldest = [...s.blocks].sort((a, b) => a.landsAt - b.landsAt)[0] ?? null
  if (!oldest) return { ...s, tiles: [], targetBlockId: null }
  if (oldest.id === s.targetBlockId) return s
  return { ...s, tiles: tilesFor(s, oldest.pieceId, rng), targetBlockId: oldest.id }
}

function spawn(s: BlitzState, now: number, rng: Rng): BlitzState {
  if (s.nextPieceIndex >= s.order.length) return s
  if (s.blocks.length >= LANES) return s
  if (now - s.lastSpawnAt < SPAWN_GAP_MS) return s
  const used = new Set(s.blocks.map((b) => b.lane))
  const free = Array.from({ length: LANES }, (_, i) => i).filter((l) => !used.has(l))
  const lane = free[Math.floor(rng() * free.length)]
  const pieceId = s.order[s.nextPieceIndex]
  const block: FallingBlock = { id: s.nextBlockId, pieceId, lane, prompt: pieceById(s, pieceId).prompt, spawnedAt: now, landsAt: now + s.fallMs }
  return { ...s, blocks: [...s.blocks, block], nextPieceIndex: s.nextPieceIndex + 1, nextBlockId: s.nextBlockId + 1, lastSpawnAt: now }
}

function end(s: BlitzState, now: number): BlitzState {
  return { ...s, status: 'over', endedAt: now, blocks: [], tiles: [], targetBlockId: null }
}

export function reduceBlitz(s: BlitzState, a: BlitzAction): BlitzState {
  if (s.status !== 'playing') return s
  // Derive the rng from state so a tick sequence is reproducible.
  const rng = mulberry32(s.seed ^ (s.nextBlockId * 7919) ^ (s.clears * 104729))

  if (a.type === 'tick') {
    const now = a.now
    if (now < s.frozenUntil) return s
    let next = s
    // Landings: every block past its time is a strike.
    const landed = next.blocks.filter((b) => b.landsAt <= now)
    if (landed.length > 0) {
      const strikes = next.strikes + landed.length
      next = { ...next, blocks: next.blocks.filter((b) => b.landsAt > now), strikes, consecutive: 0, combo: 1 }
      if (strikes >= STRIKES) return end(next, now)
    }
    next = spawn(next, now, rng)
    // Out of pieces and board clear: a win.
    if (next.nextPieceIndex >= next.order.length && next.blocks.length === 0) return end(next, now)
    return retarget(next, rng)
  }

  // tap
  const target = s.blocks.find((b) => b.id === s.targetBlockId)
  if (!target) return s
  const piece = pieceById(s, target.pieceId)
  const correct = normalizeAnswer(a.tile) === normalizeAnswer(piece.answer)
  if (correct) {
    const consecutive = s.consecutive + 1
    const clears = s.clears + 1
    const comboUp = consecutive > 0 && consecutive % COMBO_AT === 0
    const combo = comboUp ? s.combo * 2 : s.combo
    const fallMs = clears % RAMP_EVERY === 0 ? Math.max(FALL_FLOOR_MS, Math.round(s.fallMs * FALL_RAMP)) : s.fallMs
    const next: BlitzState = {
      ...s,
      blocks: s.blocks.filter((b) => b.id !== target.id),
      score: s.score + POINTS * s.combo,
      consecutive,
      combo,
      clears,
      fallMs,
      frozenUntil: comboUp ? a.now + FREEZE_MS : s.frozenUntil,
      targetBlockId: null,
      tiles: [],
    }
    if (comboUp) {
      // Freeze: push every block's landing back by the freeze so nothing
      // lands while the board is paused.
      const blocks = next.blocks.map((b) => ({ ...b, landsAt: b.landsAt + FREEZE_MS }))
      return retarget({ ...next, blocks }, rng)
    }
    return retarget(next, rng)
  }
  // Wrong tap: the block drops to 30% of its remaining time; streak resets.
  const remaining = Math.max(0, target.landsAt - a.now)
  const blocks = s.blocks.map((b) => (b.id === target.id ? { ...b, landsAt: a.now + Math.round(remaining * WRONG_TAP_REMAINING) } : b))
  return { ...s, blocks, consecutive: 0, combo: 1 }
}

/** 0..1 how far a block has fallen at `now`. */
export function progressOf(b: FallingBlock, now: number): number {
  const total = b.landsAt - b.spawnedAt
  if (total <= 0) return 1
  return Math.min(1, Math.max(0, (now - b.spawnedAt) / total))
}
