import { mulberry32, shuffle, type Rng } from './rng'

/**
 * Gauntlet — a run of twelve encounters, a knight with 100 HP, and the one
 * game that reads memory (to decide which cards become which enemies). Pure:
 * `planRun` builds the encounters, `reduceGauntlet` runs the fight. Nothing
 * here touches a database; the server action calls `planRun` and hands the
 * plan to the client.
 *
 * Design (2026-09-13 revamp): enemies, not doors. A correct answer is a
 * strike; a wrong one is a miss and the enemy hits back for damage that
 * ramps with the enemy. Bosses take several strikes and show a progress
 * bar. After every three kills the magician appears and offers a choice:
 * heal, or weaken the next enemy. Two modes — multiple choice (AI-written
 * distractors) and short answer (your accuracy on the key points is your
 * chance to hit, rolled in the open).
 */

export const MAX_HP = 100
export const MAGICIAN_EVERY = 3
export const MAGICIAN_HEAL = 15
export const RUN_LENGTH = 12

export type EnemyKind = 'slime' | 'imp' | 'dark-knight' | 'miniboss' | 'boss'
export type GauntletMode = 'mc' | 'sa'

export const ENEMIES: Record<EnemyKind, { name: string; hits: number; damage: number; points: number }> = {
  slime: { name: 'Slime', hits: 1, damage: 8, points: 50 },
  imp: { name: 'Imp', hits: 1, damage: 12, points: 75 },
  'dark-knight': { name: 'Dark knight', hits: 2, damage: 16, points: 120 },
  miniboss: { name: 'Champion', hits: 2, damage: 20, points: 200 },
  boss: { name: 'The Examiner', hits: 3, damage: 25, points: 400 },
}

/** The run's shape: a ramp with two champions and the boss last. */
export const RUN_SHAPE: readonly EnemyKind[] = [
  'slime', 'slime', 'imp', 'imp', 'dark-knight', 'miniboss',
  'imp', 'dark-knight', 'dark-knight', 'miniboss', 'dark-knight', 'boss',
]

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

export interface Encounter {
  cardId: string
  kind: EnemyKind
  /** Which side is shown as the question. */
  ask: 'term' | 'definition'
}

export interface RunPlan {
  mode: GauntletMode
  encounters: Encounter[]
  /**
   * Cards NOT on the run, seeded. After a miss the enemy asks a different
   * question: the next card here replaces the missed one, and the missed card
   * goes to the back of this queue so it comes round again later in the run.
   */
  pool: string[]
  /** True when the viewer had no memory on the set: enemies are then a plain shuffle. */
  noMemory: boolean
}

/**
 * Twelve cards for twelve enemies. With memory: the cards you know LEAST
 * become the boss and champions, the rest fill the ramp from best-known to
 * worst so difficulty rises with the enemies. A card never studied counts as
 * middling (5) — unstudied is not the same as weak. Without any memory, a
 * seeded shuffle. A set smaller than twelve cards repeats cards.
 */
export function planRun(input: {
  cards: readonly GauntletCard[]
  memory: readonly CardMemory[]
  seed: number
  mode: GauntletMode
}): RunPlan {
  const rng = mulberry32(input.seed)
  if (input.cards.length === 0) return { mode: input.mode, encounters: [], pool: [], noMemory: true }
  const mem = new Map(input.memory.map((m) => [m.cardId, m]))
  const noMemory = input.cards.every((c) => !mem.has(c.id))

  const conf = (c: GauntletCard) => {
    const m = mem.get(c.id)
    if (!m) return 5
    return m.due ? Math.min(m.confidence, 4) : m.confidence
  }

  // Pick twelve distinct cards where possible, repeating only when the set is short.
  const pool = shuffle(input.cards, rng)
  const picked: GauntletCard[] = []
  while (picked.length < RUN_LENGTH) picked.push(pool[picked.length % pool.length])

  let ordered: GauntletCard[]
  if (noMemory) {
    ordered = picked
  } else {
    // Hardest (lowest confidence) last, so the boss slot gets the weakest card.
    ordered = [...picked].sort((a, b) => conf(b) - conf(a) || a.id.localeCompare(b.id))
  }

  const encounters = RUN_SHAPE.map<Encounter>((kind, i) => ({
    cardId: ordered[i].id,
    kind,
    ask: rng() < 0.5 ? 'term' : 'definition',
  }))
  const onRun = new Set(encounters.map((e) => e.cardId))
  return { mode: input.mode, encounters, pool: pool.filter((c) => !onRun.has(c.id)).map((c) => c.id), noMemory }
}

/** MC options for an encounter from other cards' text — the no-AI fallback. */
export function fallbackOptions(card: GauntletCard, others: readonly GauntletCard[], ask: 'term' | 'definition', rng: Rng): string[] {
  const correct = ask === 'term' ? card.definition : card.term
  const pool = shuffle(others.filter((o) => o.id !== card.id).map((o) => (ask === 'term' ? o.definition : o.term)).filter((t) => t !== correct), rng)
  return shuffle([correct, ...pool.slice(0, 3)], rng)
}

// ------------------------------------------------------------------ reducer

/**
 * `review` follows every survivable miss: the card you missed is shown in
 * full before the enemy asks its next question (owner's brief, 2026-09-14 —
 * "always review it before moving on"). The enemy is still standing; only
 * the question changes.
 */
export type Phase = 'fight' | 'review' | 'magician' | 'won' | 'dead'

export interface GauntletState {
  plan: RunPlan
  index: number
  /** Strikes still needed on the current enemy. */
  enemyHitsLeft: number
  /** Set by the magician's "weaken": the next enemy hits for half. */
  weakened: boolean
  hp: number
  score: number
  kills: number
  streak: number
  bestStreak: number
  phase: Phase
  /** The card being reviewed after a miss (phase `review`), with the side that was asked. */
  review: { cardId: string; ask: 'term' | 'definition' } | null
  /** Last exchange, for the UI to narrate. */
  last: { hit: boolean; damage: number; accuracy?: number } | null
  startedAt: number
  endedAt: number | null
}

export type GauntletAction =
  | { type: 'attack'; hit: boolean; accuracy?: number; now: number }
  | { type: 'magician'; choice: 'heal' | 'weaken'; now: number }
  /** Leave the review: the enemy asks a different card. */
  | { type: 'continue'; now: number }

export function createGauntlet(plan: RunPlan, now: number): GauntletState {
  const first = plan.encounters[0]
  return {
    plan,
    index: 0,
    enemyHitsLeft: first ? ENEMIES[first.kind].hits : 0,
    weakened: false,
    hp: MAX_HP,
    score: 0,
    kills: 0,
    streak: 0,
    bestStreak: 0,
    phase: first ? 'fight' : 'won',
    review: null,
    last: null,
    startedAt: now,
    endedAt: first ? null : now,
  }
}

export function currentEncounter(s: GauntletState): Encounter | null {
  return s.phase === 'fight' || s.phase === 'magician' || s.phase === 'review' ? (s.plan.encounters[s.index] ?? null) : null
}

/** Streak bonus: +10 % per consecutive kill, capped at double. */
export function killPoints(kind: EnemyKind, streak: number): number {
  return Math.round(ENEMIES[kind].points * Math.min(2, 1 + streak * 0.1))
}

/** The end-of-run score: kills' points, HP left, and a speed bonus (under five minutes). */
export function finalScore(s: GauntletState, endedAt: number): number {
  if (s.phase === 'dead' || s.hp <= 0) return s.score
  const seconds = Math.max(0, (endedAt - s.startedAt) / 1000)
  return s.score + s.hp + Math.max(0, Math.round(300 - seconds))
}

function advance(s: GauntletState, now: number): GauntletState {
  const index = s.index + 1
  const next = s.plan.encounters[index]
  if (!next) {
    const won = { ...s, index, phase: 'won' as const, endedAt: now }
    return { ...won, score: finalScore(won, now) }
  }
  const base = ENEMIES[next.kind].hits
  return { ...s, index, enemyHitsLeft: s.weakened ? Math.max(1, base - 1) : base }
}

export function reduceGauntlet(s: GauntletState, a: GauntletAction): GauntletState {
  if (a.type === 'magician') {
    if (s.phase !== 'magician') return s
    const healed = a.choice === 'heal' ? { ...s, hp: Math.min(MAX_HP, s.hp + MAGICIAN_HEAL) } : { ...s, weakened: true }
    return advance({ ...healed, phase: 'fight' }, a.now)
  }
  if (a.type === 'continue') {
    if (s.phase !== 'review' || !s.review) return s
    // Swap the enemy's card for the next one in the pool; the missed card
    // rejoins the pool at the back. An empty pool (a twelve-card set) means
    // the same card returns — you have just reviewed it.
    const missed = s.review.cardId
    const [replacement, ...rest] = s.plan.pool
    const encounters = s.plan.encounters.map((e, i) => (i === s.index && replacement ? { ...e, cardId: replacement } : e))
    const pool = replacement ? [...rest, missed] : s.plan.pool
    return { ...s, plan: { ...s.plan, encounters, pool }, phase: 'fight', review: null }
  }
  if (s.phase !== 'fight') return s
  const enc = s.plan.encounters[s.index]
  if (!enc) return s
  const enemy = ENEMIES[enc.kind]

  if (a.hit) {
    const hitsLeft = s.enemyHitsLeft - 1
    if (hitsLeft > 0) return { ...s, enemyHitsLeft: hitsLeft, last: { hit: true, damage: 0, accuracy: a.accuracy } }
    const streak = s.streak + 1
    const kills = s.kills + 1
    const killed: GauntletState = {
      ...s,
      score: s.score + killPoints(enc.kind, s.streak),
      kills,
      streak,
      bestStreak: Math.max(s.bestStreak, streak),
      weakened: false,
      last: { hit: true, damage: 0, accuracy: a.accuracy },
    }
    const isLast = s.index + 1 >= s.plan.encounters.length
    if (!isLast && kills % MAGICIAN_EVERY === 0) return { ...killed, phase: 'magician' }
    return advance(killed, a.now)
  }

  // Miss: the enemy hits back. Weakened enemies hit for half.
  const damage = s.weakened ? Math.ceil(enemy.damage / 2) : enemy.damage
  const hp = Math.max(0, s.hp - damage)
  const hurt: GauntletState = { ...s, hp, streak: 0, last: { hit: false, damage, accuracy: a.accuracy } }
  if (hp <= 0) return { ...hurt, phase: 'dead', endedAt: a.now }
  return { ...hurt, phase: 'review', review: { cardId: enc.cardId, ask: enc.ask } }
}

/** 0..1 through the run, for the progress bar. */
export function runProgress(s: GauntletState): number {
  const n = s.plan.encounters.length
  if (n === 0) return 1
  return Math.min(1, (s.kills + (s.phase === 'won' ? 0 : 0)) / n)
}

export interface GauntletSummary {
  status: 'won' | 'dead'
  score: number
  kills: number
  hp: number
  bestStreak: number
  elapsedMs: number
}

export function summarize(s: GauntletState): GauntletSummary | null {
  if ((s.phase !== 'won' && s.phase !== 'dead') || s.endedAt === null) return null
  return { status: s.phase, score: s.score, kills: s.kills, hp: s.hp, bestStreak: s.bestStreak, elapsedMs: s.endedAt - s.startedAt }
}

/** Short-answer mode: the roll. `accuracy` 0..1 is the chance to hit; `roll` is uniform 0..1. */
export function rollHit(accuracy: number, roll: number): boolean {
  return roll < Math.max(0, Math.min(1, accuracy))
}
