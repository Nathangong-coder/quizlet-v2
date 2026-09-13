import { mulberry32, shuffle, type Rng } from './rng'

/**
 * Gauntlet — the one game that reads memory. Pure: `planRun` turns cards +
 * the viewer's memory into an ordered list of rooms, and `reduce` runs the
 * lives/streak/shield machine. Nothing here touches a database; the server
 * action calls `planRun` and hands the rooms to the client.
 *
 * Design: docs/superpowers/specs/2026-09-13-learning-games-design.md §2.1.
 */

export const GAUNTLET_LIVES = 3
export const SHIELD_EVERY = 5
export const BOSS_COUNT = 3
/** Confidence at or above which a card is a corridor (when not due). */
export const CORRIDOR_CONFIDENCE = 7
/** Below this a card is a door candidate; the lowest BOSS_COUNT become bosses. */
export const DOOR_CONFIDENCE_MIN = 4

export type RoomKind = 'corridor' | 'door' | 'boss'
export type RoomFormat = 'mc' | 'typed'

export interface GauntletCard {
  id: string
  term: string
  definition: string
}

export interface CardMemory {
  cardId: string
  confidence: number
  due: boolean
}

export interface Room {
  cardId: string
  kind: RoomKind
  format: RoomFormat
  /** Bosses need two hits: def→term then term→def. */
  hitsNeeded: 1 | 2
  /** Which side is shown first. */
  ask: 'term' | 'definition'
  /** MC options (the correct one included), only when format = mc. */
  options?: string[]
}

export interface RunPlan {
  rooms: Room[]
  /** True when the viewer had no memory on the set: corridors only. */
  noMemory: boolean
  /** Number of typed prompts the run will make at most (AI calls). */
  typedPrompts: number
}

function mcOptions(card: GauntletCard, others: readonly GauntletCard[], ask: 'term' | 'definition', rng: Rng): string[] {
  const correct = ask === 'term' ? card.definition : card.term
  const pool = shuffle(
    others.filter((o) => o.id !== card.id).map((o) => (ask === 'term' ? o.definition : o.term)).filter((t) => t !== correct),
    rng,
  )
  return shuffle([correct, ...pool.slice(0, 3)], rng)
}

/**
 * Corridors and doors shuffled by seed, bosses last, worst boss final. A
 * viewer with no memory gets corridors only (and the launch screen says so).
 * `mcOnly` turns every room into MC — zero AI calls.
 */
export function planRun(input: {
  cards: readonly GauntletCard[]
  memory: readonly CardMemory[]
  seed: number
  mcOnly?: boolean
}): RunPlan {
  const rng = mulberry32(input.seed)
  const mem = new Map(input.memory.map((m) => [m.cardId, m]))
  const noMemory = input.cards.every((c) => !mem.has(c.id))
  const fmt = (f: RoomFormat): RoomFormat => (input.mcOnly ? 'mc' : f)

  if (noMemory) {
    const rooms = shuffle(input.cards, rng).map<Room>((c) => ({
      cardId: c.id,
      kind: 'corridor',
      format: 'mc',
      hitsNeeded: 1,
      ask: 'term',
      options: mcOptions(c, input.cards, 'term', rng),
    }))
    return { rooms, noMemory: true, typedPrompts: 0 }
  }

  // Bosses: the BOSS_COUNT lowest-confidence cards WITH memory (an unstudied
  // card is not a known weakness). Worst last.
  const withMem = input.cards.filter((c) => mem.has(c.id))
  const bosses = [...withMem]
    .sort((a, b) => mem.get(a.id)!.confidence - mem.get(b.id)!.confidence || a.id.localeCompare(b.id))
    .slice(0, BOSS_COUNT)
    .reverse()
  const bossIds = new Set(bosses.map((b) => b.id))

  const rest = input.cards.filter((c) => !bossIds.has(c.id))
  const body = shuffle(rest, rng).map<Room>((c) => {
    const m = mem.get(c.id)
    const corridor = m !== undefined && m.confidence >= CORRIDOR_CONFIDENCE && !m.due
    // Unstudied cards are corridors too: nothing says they are weak.
    const kind: RoomKind = m === undefined || corridor ? 'corridor' : 'door'
    const ask = rng() < 0.5 ? 'term' : 'definition'
    const format = fmt(kind === 'door' ? 'typed' : 'mc')
    return {
      cardId: c.id,
      kind,
      format,
      hitsNeeded: 1,
      ask,
      ...(format === 'mc' ? { options: mcOptions(c, input.cards, ask, rng) } : {}),
    }
  })

  const bossRooms = bosses.map<Room>((c) => {
    const format = fmt('typed')
    return {
      cardId: c.id,
      kind: 'boss',
      format,
      hitsNeeded: 2,
      ask: 'definition',
      ...(format === 'mc' ? { options: mcOptions(c, input.cards, 'definition', rng) } : {}),
    }
  })

  const rooms = [...body, ...bossRooms]
  const typedPrompts = rooms.reduce((n, r) => n + (r.format === 'typed' ? r.hitsNeeded : 0), 0)
  return { rooms, noMemory: false, typedPrompts }
}

// ------------------------------------------------------------------ reducer

export interface GauntletState {
  queue: Room[]
  /** Index into `queue` of the current room. */
  index: number
  /** Hits landed on the current room so far (bosses need 2). */
  hits: number
  lives: number
  streak: number
  bestStreak: number
  shields: number
  roomsCleared: number
  bossesBeaten: number
  /** Cards re-queued once already, so a second miss does not loop forever. */
  requeued: Set<string>
  status: 'playing' | 'won' | 'dead'
  startedAt: number
  endedAt: number | null
}

export type GauntletAction = { type: 'hit'; now: number } | { type: 'miss'; now: number }

export function createGauntlet(plan: RunPlan, now: number): GauntletState {
  return {
    queue: [...plan.rooms],
    index: 0,
    hits: 0,
    lives: GAUNTLET_LIVES,
    streak: 0,
    bestStreak: 0,
    shields: 0,
    roomsCleared: 0,
    bossesBeaten: 0,
    requeued: new Set(),
    status: plan.rooms.length === 0 ? 'won' : 'playing',
    startedAt: now,
    endedAt: plan.rooms.length === 0 ? now : null,
  }
}

export function currentRoom(s: GauntletState): Room | null {
  return s.status === 'playing' ? (s.queue[s.index] ?? null) : null
}

/** A boss's second hit asks the other side. */
export function currentAsk(s: GauntletState): 'term' | 'definition' {
  const r = currentRoom(s)
  if (!r) return 'term'
  if (r.hitsNeeded === 2 && s.hits === 1) return r.ask === 'term' ? 'definition' : 'term'
  return r.ask
}

function advance(s: GauntletState, now: number): GauntletState {
  const next = s.index + 1
  if (next >= s.queue.length) return { ...s, index: next, hits: 0, status: 'won', endedAt: now }
  return { ...s, index: next, hits: 0 }
}

export function reduceGauntlet(s: GauntletState, a: GauntletAction): GauntletState {
  if (s.status !== 'playing') return s
  const room = s.queue[s.index]
  if (!room) return s

  if (a.type === 'hit') {
    const hits = s.hits + 1
    if (hits < room.hitsNeeded) return { ...s, hits }
    const streak = s.streak + 1
    const shields = streak % SHIELD_EVERY === 0 ? s.shields + 1 : s.shields
    return advance(
      {
        ...s,
        streak,
        bestStreak: Math.max(s.bestStreak, streak),
        shields,
        roomsCleared: s.roomsCleared + 1,
        bossesBeaten: s.bossesBeaten + (room.kind === 'boss' ? 1 : 0),
      },
      a.now,
    )
  }

  // miss
  let next: GauntletState = { ...s, streak: 0, hits: 0 }
  if (s.shields > 0) {
    next = { ...next, shields: s.shields - 1 }
  } else {
    next = { ...next, lives: s.lives - 1 }
    if (next.lives <= 0) return { ...next, status: 'dead', endedAt: a.now }
  }
  // Re-queue once, at the end; a second miss on the same card moves on.
  if (!s.requeued.has(room.cardId)) {
    const requeued = new Set(s.requeued)
    requeued.add(room.cardId)
    next = { ...next, requeued, queue: [...s.queue, room] }
  }
  return advance(next, a.now)
}

export interface GauntletSummary {
  roomsCleared: number
  bossesBeaten: number
  elapsedMs: number
  bestStreak: number
  status: 'won' | 'dead'
}

export function summarize(s: GauntletState): GauntletSummary | null {
  if (s.status === 'playing' || s.endedAt === null) return null
  return { roomsCleared: s.roomsCleared, bossesBeaten: s.bossesBeaten, elapsedMs: s.endedAt - s.startedAt, bestStreak: s.bestStreak, status: s.status }
}
