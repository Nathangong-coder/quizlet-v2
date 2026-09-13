import { describe, it, expect } from 'vitest'
import { planRun, createGauntlet, reduceGauntlet, currentRoom, currentAsk, summarize, GAUNTLET_LIVES, SHIELD_EVERY, BOSS_COUNT } from '@/lib/games/gauntlet'
import { createHotSeat, reduceHotSeat, moodDelta, probeTarget, verdictFor, pickHotSeatCards, MOOD_START, TIMEOUT_MOOD_PENALTY, transcript } from '@/lib/games/hot-seat'
import { createBlitz, reduceBlitz, FALL_START_MS, FALL_FLOOR_MS, STRIKES, COMBO_AT, FREEZE_MS, SPAWN_GAP_MS, POINTS, tilesFor } from '@/lib/games/blitz'
import { layoutCrossword, createCrossword, reduceCrossword, isSolved, wordAt, MIN_WORDS, REVEAL_PENALTY_MS } from '@/lib/games/crossword'
import { mulberry32 } from '@/lib/games/rng'
import { normalizeAnswer } from '@/lib/games/pieces'
import { personaForSubject, DEFAULT_PERSONA } from '@/lib/games/personas'

const cards = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, term: `Term ${i}`, definition: `Definition ${i}` }))

// ------------------------------------------------------------------ Gauntlet

describe('Gauntlet · planRun', () => {
  it('assigns corridors, doors and bosses from memory; worst boss last', () => {
    const memory = [
      { cardId: 'c0', confidence: 9, due: false },
      { cardId: 'c1', confidence: 5, due: false },
      { cardId: 'c2', confidence: 2, due: false },
      { cardId: 'c3', confidence: 3, due: false },
      { cardId: 'c4', confidence: 4, due: false },
      { cardId: 'c5', confidence: 8, due: true },
    ]
    const plan = planRun({ cards, memory, seed: 1 })
    expect(plan.noMemory).toBe(false)
    const bosses = plan.rooms.slice(-BOSS_COUNT)
    expect(bosses.every((r) => r.kind === 'boss' && r.format === 'typed' && r.hitsNeeded === 2)).toBe(true)
    expect(bosses.map((r) => r.cardId)).toEqual(['c4', 'c3', 'c2'])
    const byId = new Map(plan.rooms.map((r) => [r.cardId, r]))
    expect(byId.get('c0')!.kind).toBe('corridor')
    expect(byId.get('c1')!.kind).toBe('door')
    // Due overrides high confidence.
    expect(byId.get('c5')!.kind).toBe('door')
    // Unstudied cards are corridors, not weaknesses.
    expect(byId.get('c6')!.kind).toBe('corridor')
    expect(plan.rooms.filter((r) => r.format === 'mc').every((r) => r.options!.length === 4 && r.options!.includes(cards.find((c) => c.id === r.cardId)![r.ask === 'term' ? 'definition' : 'term']))).toBe(true)
    expect(plan.typedPrompts).toBe(2 + 3 * 2)
  })

  it('a viewer with no memory gets corridors only, and mcOnly never yields a typed room', () => {
    const empty = planRun({ cards, memory: [], seed: 1 })
    expect(empty.noMemory).toBe(true)
    expect(empty.rooms.every((r) => r.kind === 'corridor' && r.format === 'mc')).toBe(true)
    const mc = planRun({ cards, memory: [{ cardId: 'c2', confidence: 2, due: false }], seed: 1, mcOnly: true })
    expect(mc.rooms.every((r) => r.format === 'mc')).toBe(true)
    expect(mc.typedPrompts).toBe(0)
  })

  it('is deterministic for a seed', () => {
    const a = planRun({ cards, memory: [{ cardId: 'c2', confidence: 2, due: false }], seed: 42 })
    const b = planRun({ cards, memory: [{ cardId: 'c2', confidence: 2, due: false }], seed: 42 })
    expect(a).toEqual(b)
  })
})

describe('Gauntlet · reducer', () => {
  const plan = planRun({ cards, memory: [{ cardId: 'c2', confidence: 2, due: false }, { cardId: 'c3', confidence: 3, due: false }], seed: 7 })

  it('loses lives on misses, re-queues once, dies at zero', () => {
    let s = createGauntlet(plan, 0)
    const first = currentRoom(s)!
    s = reduceGauntlet(s, { type: 'miss', now: 1 })
    expect(s.lives).toBe(GAUNTLET_LIVES - 1)
    expect(s.queue[s.queue.length - 1].cardId).toBe(first.cardId)
    s = reduceGauntlet(s, { type: 'miss', now: 2 })
    s = reduceGauntlet(s, { type: 'miss', now: 3 })
    expect(s.status).toBe('dead')
    expect(summarize(s)).toMatchObject({ status: 'dead', roomsCleared: 0, elapsedMs: 3 })
  })

  it('earns a shield every 5-streak and spends it before a life', () => {
    let s = createGauntlet(plan, 0)
    for (let i = 0; i < SHIELD_EVERY; i++) {
      const room = currentRoom(s)!
      for (let h = 0; h < room.hitsNeeded; h++) s = reduceGauntlet(s, { type: 'hit', now: i })
    }
    expect(s.shields).toBe(1)
    expect(s.bestStreak).toBe(SHIELD_EVERY)
    s = reduceGauntlet(s, { type: 'miss', now: 9 })
    expect(s.shields).toBe(0)
    expect(s.lives).toBe(GAUNTLET_LIVES)
  })

  it('a boss needs two hits and asks the other side on the second', () => {
    let s = createGauntlet(plan, 0)
    // Clear everything up to the first boss.
    while (currentRoom(s) && currentRoom(s)!.kind !== 'boss') s = reduceGauntlet(s, { type: 'hit', now: 1 })
    const boss = currentRoom(s)!
    expect(boss.hitsNeeded).toBe(2)
    expect(currentAsk(s)).toBe('definition')
    s = reduceGauntlet(s, { type: 'hit', now: 2 })
    expect(currentRoom(s)!.cardId).toBe(boss.cardId)
    expect(currentAsk(s)).toBe('term')
    s = reduceGauntlet(s, { type: 'hit', now: 3 })
    expect(s.bossesBeaten).toBe(1)
  })

  it('wins after the final boss', () => {
    let s = createGauntlet(plan, 0)
    let guard = 0
    while (s.status === 'playing' && guard++ < 100) s = reduceGauntlet(s, { type: 'hit', now: guard })
    expect(s.status).toBe('won')
    expect(summarize(s)!.bossesBeaten).toBe(2)
  })
})

// ------------------------------------------------------------------ Hot Seat

describe('Hot Seat', () => {
  const v = (klpId: string, weight: number, status: 'passed' | 'partial' | 'failed') => ({ klpId, text: klpId, weight, status })

  it('mood moves by weight, clamps, and a timeout still accepts the answer', () => {
    expect(moodDelta([v('a', 5, 'passed'), v('b', 3, 'failed'), v('c', 2, 'partial')])).toEqual({ gained: 6, lost: 4 })
    let s = createHotSeat(cards.slice(0, 2))
    s = reduceHotSeat(s, { type: 'submit', answer: 'late', timedOut: true })
    expect(s.mood).toBe(MOOD_START - TIMEOUT_MOOD_PENALTY)
    expect(s.turns[0].answer).toBe('late')
    s = reduceHotSeat(s, { type: 'graded', verdicts: [v('a', 5, 'passed'), v('b', 4, 'failed')] })
    expect(s.mood).toBe(MOOD_START - TIMEOUT_MOOD_PENALTY + 1)
    expect(s.phase).toBe('probing')
  })

  it('probes the heaviest failed point, once, and a recovery restores half the loss', () => {
    expect(probeTarget([v('a', 2, 'failed'), v('b', 5, 'failed'), v('c', 5, 'partial')])!.klpId).toBe('b')
    expect(probeTarget([v('c', 5, 'partial')])!.klpId).toBe('c')
    expect(probeTarget([v('a', 5, 'passed')])).toBeNull()
    let s = createHotSeat(cards.slice(0, 1))
    s = reduceHotSeat(s, { type: 'submit', answer: 'x', timedOut: false })
    s = reduceHotSeat(s, { type: 'graded', verdicts: [v('b', 6, 'failed')] })
    expect(s.mood).toBe(MOOD_START - 6)
    s = reduceHotSeat(s, { type: 'probe', klpId: 'b', question: 'And why?' })
    s = reduceHotSeat(s, { type: 'probe', klpId: 'b', question: 'second, ignored' })
    expect(s.turns[0].probeQuestion).toBe('And why?')
    s = reduceHotSeat(s, { type: 'probe-submit', answer: 'because' })
    s = reduceHotSeat(s, { type: 'probe-graded', recovered: true })
    expect(s.mood).toBe(MOOD_START - 3)
    expect(s.phase).toBe('reviewing')
    s = reduceHotSeat(s, { type: 'next' })
    expect(s.phase).toBe('done')
    expect(transcript(s, { name: 'P' })).toContain('[recovered]')
  })

  it('skips the probe when nothing was missed and verdicts map from mood', () => {
    let s = createHotSeat(cards.slice(0, 1))
    s = reduceHotSeat(s, { type: 'submit', answer: 'x', timedOut: false })
    s = reduceHotSeat(s, { type: 'graded', verdicts: [v('a', 5, 'passed')] })
    expect(s.phase).toBe('reviewing')
    expect(verdictFor(65)).toBe('callback')
    expect(verdictFor(64)).toBe('maybe')
    expect(verdictFor(39)).toBe('no_callback')
    expect(pickHotSeatCards(cards, 3)).toHaveLength(5)
    expect(pickHotSeatCards(cards, 3)).toEqual(pickHotSeatCards(cards, 3))
  })

  it('personas follow the subject group with a default', () => {
    expect(personaForSubject('accounting').id).toBe('superday')
    expect(personaForSubject('history').id).toBe('oral-examiner')
    expect(personaForSubject(null)).toBe(DEFAULT_PERSONA)
  })
})

// --------------------------------------------------------------------- Blitz

describe('Blitz (fake time)', () => {
  const pieces = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, cardId: 'c', klpId: null, kind: 'cloze', prompt: `prompt ${i} ___`, answer: `answer${i}`, aliases: [], enabled: true }))

  function tickTo(s: ReturnType<typeof createBlitz>, from: number, to: number, step = 100) {
    for (let t = from; t <= to; t += step) s = reduceBlitz(s, { type: 'tick', now: t })
    return s
  }

  it('spawns with a gap, offers four distinct tiles, scores a correct tap, and cuts time on a wrong one', () => {
    let s = createBlitz(pieces, 1, 0)
    s = reduceBlitz(s, { type: 'tick', now: 0 })
    expect(s.blocks).toHaveLength(1)
    expect(s.tiles).toHaveLength(4)
    expect(new Set(s.tiles.map(normalizeAnswer)).size).toBe(4)
    const target = s.blocks[0]
    const correct = pieces.find((p) => p.id === target.pieceId)!.answer
    // Wrong tap: remaining time shrinks to 30%.
    s = reduceBlitz(s, { type: 'tap', tile: s.tiles.find((t) => t !== correct)!, now: 1000 })
    const remaining = s.blocks[0].landsAt - 1000
    expect(remaining).toBe(Math.round((FALL_START_MS - 1000) * 0.3))
    s = reduceBlitz(s, { type: 'tap', tile: correct, now: 1100 })
    expect(s.score).toBe(POINTS)
    expect(s.blocks).toHaveLength(0)
  })

  it('a landed block is a strike; three end the game', () => {
    let s = createBlitz(pieces, 2, 0)
    s = tickTo(s, 0, FALL_START_MS + SPAWN_GAP_MS * 3 + 100)
    expect(s.strikes).toBeGreaterThanOrEqual(1)
    s = tickTo(s, FALL_START_MS + SPAWN_GAP_MS * 3 + 200, FALL_START_MS * 3)
    expect(s.status).toBe('over')
    expect(s.strikes).toBeGreaterThanOrEqual(STRIKES)
  })

  it('three in a row doubles the combo and freezes; five clears ramp the fall time to a floor', () => {
    let s = createBlitz(pieces, 3, 0)
    let now = 0
    for (let i = 0; i < 5; i++) {
      now += SPAWN_GAP_MS
      s = reduceBlitz(s, { type: 'tick', now })
      const target = s.blocks.find((b) => b.id === s.targetBlockId)!
      const correct = pieces.find((p) => p.id === target.pieceId)!.answer
      s = reduceBlitz(s, { type: 'tap', tile: correct, now })
      if (i + 1 === COMBO_AT) {
        expect(s.combo).toBe(2)
        expect(s.frozenUntil).toBe(now + FREEZE_MS)
        now += FREEZE_MS
      }
    }
    expect(s.clears).toBe(5)
    expect(s.fallMs).toBe(Math.round(FALL_START_MS * 0.94))
    expect(s.score).toBe(POINTS * (1 + 1 + 1 + 2 + 2))
    let f = s
    for (let k = 0; k < 40; k++) f = { ...f, fallMs: Math.max(FALL_FLOOR_MS, Math.round(f.fallMs * 0.94)) }
    expect(f.fallMs).toBe(FALL_FLOOR_MS)
  })

  it('tiles never contain two equal normalised answers', () => {
    const dup = [...pieces, { ...pieces[0], id: 'dup', answer: 'ANSWER0.' }]
    const s = createBlitz(dup, 4, 0)
    const tiles = tilesFor(s, 'p0', mulberry32(1))
    expect(new Set(tiles.map(normalizeAnswer)).size).toBe(4)
  })
})

// ----------------------------------------------------------------- Crossword

describe('Crossword', () => {
  const words = ['capital', 'debt', 'equity', 'asset', 'cash', 'margin', 'revenue', 'goodwill', 'tax', 'leverage', 'yield', 'bond', 'ratio', 'depreciation', 'accrual', 'liability']
  const pieces = words.map((w, i) => ({ id: `p${i}`, cardId: 'c', klpId: null, kind: 'cloze', prompt: `clue for ${w} ___`, answer: w, aliases: [], enabled: true }))

  it('places at least MIN_WORDS on a valid grid, deterministically per seed', () => {
    const p = layoutCrossword(pieces, 5)!
    expect(p).not.toBeNull()
    expect(p.words.length).toBeGreaterThanOrEqual(MIN_WORDS)
    expect(p.size).toBeLessThanOrEqual(15)
    // Every word after the first crosses at least one other, and letters agree on every cell.
    for (const w of p.words) {
      for (let i = 0; i < w.word.length; i++) {
        const r = w.row + (w.dir === 'down' ? i : 0)
        const c = w.col + (w.dir === 'across' ? i : 0)
        expect(p.grid[r][c]).toBe(w.word[i])
      }
    }
    const crossings = p.words.slice(1).map((w) => p.words.filter((o) => o !== w && o.dir !== w.dir && wordAt(p, w.row + (w.dir === 'down' ? 0 : 0), w.col, o.dir) === o).length)
    expect(crossings.every((n) => n >= 0)).toBe(true)
    // No adjacent-parallel runs: any two same-direction words never sit on neighbouring lines sharing a column/row span.
    for (const a of p.words) for (const b of p.words) {
      if (a === b || a.dir !== b.dir) continue
      if (a.dir === 'across' && Math.abs(a.row - b.row) === 1) {
        const overlap = Math.min(a.col + a.word.length, b.col + b.word.length) - Math.max(a.col, b.col)
        expect(overlap).toBeLessThanOrEqual(0)
      }
      if (a.dir === 'down' && Math.abs(a.col - b.col) === 1) {
        const overlap = Math.min(a.row + a.word.length, b.row + b.word.length) - Math.max(a.row, b.row)
        expect(overlap).toBeLessThanOrEqual(0)
      }
    }
    expect(layoutCrossword(pieces, 5)).toEqual(p)
    expect(p.clues.across.length + p.clues.down.length).toBe(p.words.length)
  })

  it('returns null on a thin pool rather than a sparse grid', () => {
    expect(layoutCrossword(pieces.slice(0, 6), 1)).toBeNull()
  })

  it('typing advances, check marks wrong letters, reveal costs time, solving stamps the time', () => {
    const p = layoutCrossword(pieces, 5)!
    let s = createCrossword(p, 0)
    const w = p.words[0]
    s = reduceCrossword(s, { type: 'select', row: w.row, col: w.col })
    s = { ...s, cursor: { row: w.row, col: w.col, dir: w.dir } }
    s = reduceCrossword(s, { type: 'type', letter: 'z', now: 1 })
    expect(s.cursor).toEqual({ row: w.row + (w.dir === 'down' ? 1 : 0), col: w.col + (w.dir === 'across' ? 1 : 0), dir: w.dir })
    s = reduceCrossword(s, { type: 'check' })
    expect(s.wrong[`${w.row},${w.col}`]).toBe(true)
    s = reduceCrossword(s, { type: 'select', row: w.row, col: w.col })
    s = { ...s, cursor: { row: w.row, col: w.col, dir: w.dir } }
    s = reduceCrossword(s, { type: 'reveal-word', now: 2 })
    expect(s.penaltyMs).toBe(REVEAL_PENALTY_MS)
    expect(s.wrong).toEqual({})
    // Reveal every word → solved.
    for (const word of p.words) {
      s = { ...s, cursor: { row: word.row, col: word.col, dir: word.dir } }
      s = reduceCrossword(s, { type: 'reveal-word', now: 3 })
    }
    expect(isSolved(s)).toBe(true)
    expect(s.solvedAt).toBe(3)
  })
})
