import { describe, it, expect } from 'vitest'
import { planRun, createGauntlet, reduceGauntlet, summarize, rollHit, killPoints, ENEMIES, RUN_SHAPE, RUN_LENGTH, MAX_HP, MAGICIAN_HEAL } from '@/lib/games/gauntlet'
import { createHotSeat, reduceHotSeat, moodDelta, probeTarget, verdictFor, pickHotSeatCards, faceFor, HOT_SEAT_MODES, MOOD_START, TIMEOUT_MOOD_PENALTY, transcript, type HotSeatAction } from '@/lib/games/hot-seat'
import { createBlitz, reduceBlitz, FALL_START_MS, FALL_FLOOR_MS, STRIKES, COMBO_AT, FREEZE_MS, SPAWN_GAP_MS, POINTS, tilesFor } from '@/lib/games/blitz'
import { layoutCrossword, createCrossword, reduceCrossword, isSolved, wordAt, MIN_WORDS, REVEAL_PENALTY_MS } from '@/lib/games/crossword'
import { mulberry32 } from '@/lib/games/rng'
import { normalizeAnswer } from '@/lib/games/pieces'
import { personaForSubject, DEFAULT_PERSONA } from '@/lib/games/personas'

const cards = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, term: `Term ${i}`, definition: `Definition ${i}` }))

// ------------------------------------------------------------------ Gauntlet

describe('Gauntlet · planRun', () => {
  it('builds twelve encounters in the run shape, weakest cards last (boss and champions)', () => {
    const memory = cards.map((c, i) => ({ cardId: c.id, confidence: 9 - i, due: false }))
    const plan = planRun({ cards, memory, seed: 1, mode: 'mc' })
    expect(plan.encounters).toHaveLength(RUN_LENGTH)
    expect(plan.encounters.map((e) => e.kind)).toEqual(RUN_SHAPE)
    expect(plan.noMemory).toBe(false)
    // The boss gets the least-confident card; the first slime the most confident.
    expect(plan.encounters[RUN_LENGTH - 1].cardId).toBe('c7')
    expect(plan.encounters[0].cardId).toBe('c0')
  })

  it('treats due cards as weak and unstudied cards as middling', () => {
    const memory = [{ cardId: 'c0', confidence: 9, due: true }, { cardId: 'c1', confidence: 8, due: false }]
    const plan = planRun({ cards, memory, seed: 2, mode: 'sa' })
    expect(plan.encounters[RUN_LENGTH - 1].cardId).toBe('c0')
  })

  it('with no memory shuffles by seed, and a short set repeats cards', () => {
    const plan = planRun({ cards: cards.slice(0, 3), memory: [], seed: 3, mode: 'mc' })
    expect(plan.noMemory).toBe(true)
    expect(plan.encounters).toHaveLength(RUN_LENGTH)
    expect(new Set(plan.encounters.map((e) => e.cardId)).size).toBe(3)
    expect(planRun({ cards, memory: [], seed: 3, mode: 'mc' })).toEqual(planRun({ cards, memory: [], seed: 3, mode: 'mc' }))
  })

  it('an empty set yields an empty, already-won run', () => {
    const s = createGauntlet(planRun({ cards: [], memory: [], seed: 1, mode: 'mc' }), 0)
    expect(s.phase).toBe('won')
  })
})

describe('Gauntlet · reducer', () => {
  const plan = planRun({ cards, memory: [{ cardId: 'c2', confidence: 2, due: false }], seed: 7, mode: 'mc' })
  const hit = (s: ReturnType<typeof createGauntlet>, now = 1) => reduceGauntlet(s, { type: 'attack', hit: true, now })
  const miss = (s: ReturnType<typeof createGauntlet>, now = 1) => reduceGauntlet(s, { type: 'attack', hit: false, now })

  it('a miss costs the enemy\u2019s damage and resets the streak; damage ramps by enemy', () => {
    let s = createGauntlet(plan, 0)
    s = miss(s)
    expect(s.hp).toBe(MAX_HP - ENEMIES.slime.damage)
    expect(s.streak).toBe(0)
    expect(s.last).toEqual({ hit: false, damage: ENEMIES.slime.damage, accuracy: undefined })
    expect(ENEMIES.boss.damage).toBeGreaterThan(ENEMIES['dark-knight'].damage)
    expect(ENEMIES['dark-knight'].damage).toBeGreaterThan(ENEMIES.slime.damage)
  })

  it('dies at zero HP', () => {
    let s = createGauntlet(plan, 0)
    for (let i = 0; i < 20 && s.phase === 'fight'; i++) s = miss(s, i)
    expect(s.phase).toBe('dead')
    expect(s.hp).toBe(0)
    expect(summarize(s)?.status).toBe('dead')
  })

  it('a kill scores with a streak bonus, and every third kill brings the magician', () => {
    let s = createGauntlet(plan, 0)
    s = hit(s) // slime 1
    expect(s.kills).toBe(1)
    expect(s.score).toBe(killPoints('slime', 0))
    s = hit(s) // slime 2
    expect(s.score).toBe(killPoints('slime', 0) + killPoints('slime', 1))
    s = hit(s) // imp — third kill
    expect(s.kills).toBe(3)
    expect(s.phase).toBe('magician')
    // Attacks are ignored while the magician is out.
    expect(hit(s)).toBe(s)
  })

  it('the magician heals or weakens the next enemy', () => {
    let s = createGauntlet(plan, 0)
    s = miss(s)
    for (let i = 0; i < 3; i++) s = hit(s)
    expect(s.phase).toBe('magician')
    const healed = reduceGauntlet(s, { type: 'magician', choice: 'heal', now: 1 })
    expect(healed.hp).toBe(Math.min(MAX_HP, s.hp + MAGICIAN_HEAL))
    expect(healed.phase).toBe('fight')
    const cursed = reduceGauntlet(s, { type: 'magician', choice: 'weaken', now: 1 })
    expect(cursed.weakened).toBe(true)
    // The next enemy (an imp, 1 hit) still needs a hit, but hits for half.
    const c = miss(cursed)
    expect(c.hp).toBe(cursed.hp - Math.ceil(ENEMIES.imp.damage / 2))
  })

  it('a boss needs three strikes and shows progress; winning adds HP and a speed bonus', () => {
    let s = createGauntlet(plan, 0)
    let guard = 0
    while (s.phase !== 'won' && guard++ < 60) {
      if (s.phase === 'magician') s = reduceGauntlet(s, { type: 'magician', choice: 'heal', now: guard })
      else s = hit(s, guard)
    }
    expect(s.phase).toBe('won')
    const done = summarize(s)!
    expect(done.kills).toBe(RUN_LENGTH)
    expect(done.hp).toBe(MAX_HP)
    // Every kill's points + HP + up to 300 speed bonus.
    expect(done.score).toBeGreaterThan(MAX_HP)
    // The boss took three hits: the run needed more attacks than enemies.
    expect(guard).toBeGreaterThan(RUN_LENGTH)
  })

  it('short-answer rolls: accuracy is the chance to hit', () => {
    expect(rollHit(0.7, 0.69)).toBe(true)
    expect(rollHit(0.7, 0.7)).toBe(false)
    expect(rollHit(1, 0.999)).toBe(true)
    expect(rollHit(0, 0)).toBe(false)
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

  it('harder modes lose more and recover less, over more rounds', () => {
    expect(HOT_SEAT_MODES.easy.rounds).toBeLessThan(HOT_SEAT_MODES.normal.rounds)
    expect(HOT_SEAT_MODES.normal.rounds).toBeLessThan(HOT_SEAT_MODES.hard.rounds)
    let hard = createHotSeat(cards.slice(0, 1), 'hard')
    let easy = createHotSeat(cards.slice(0, 1), 'easy')
    for (const step of [{ type: 'submit', answer: 'x', timedOut: false }, { type: 'graded', verdicts: [v('b', 10, 'failed')] }] as HotSeatAction[]) {
      hard = reduceHotSeat(hard, step)
      easy = reduceHotSeat(easy, step)
    }
    expect(MOOD_START - hard.mood).toBeCloseTo(10 * HOT_SEAT_MODES.hard.decay)
    expect(MOOD_START - easy.mood).toBeCloseTo(10 * HOT_SEAT_MODES.easy.decay)
    for (const step of [{ type: 'probe', klpId: 'b', question: 'q' }, { type: 'probe-submit', answer: 'a' }, { type: 'probe-graded', recovered: true }] as HotSeatAction[]) {
      hard = reduceHotSeat(hard, step)
      easy = reduceHotSeat(easy, step)
    }
    expect(hard.mood).toBeCloseTo(MOOD_START - 15 + 15 * HOT_SEAT_MODES.hard.recovery)
    expect(easy.mood).toBeCloseTo(MOOD_START - 7 + 7 * HOT_SEAT_MODES.easy.recovery)
  })

  it('the face follows the share of points earned', () => {
    expect(faceFor([])).toBe('neutral')
    expect(faceFor([v('a', 5, 'passed')])).toBe('impressed')
    expect(faceFor([v('a', 5, 'passed'), v('b', 1, 'failed')])).toBe('pleased')
    expect(faceFor([v('a', 5, 'passed'), v('b', 5, 'failed')])).toBe('skeptical')
    expect(faceFor([v('a', 1, 'passed'), v('b', 5, 'failed')])).toBe('annoyed')
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
