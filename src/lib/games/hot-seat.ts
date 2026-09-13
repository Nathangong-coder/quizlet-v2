import { mulberry32, shuffle } from './rng'

/**
 * Hot Seat — the short-answer game. Pure mood arithmetic and the
 * question/probe machine; grading and probe-writing are server actions the
 * component calls between reductions. Nothing is persisted.
 *
 * Design: docs/superpowers/specs/2026-09-13-learning-games-design.md §2.2.
 */

export const HOT_SEAT_QUESTIONS = 5
export const HOT_SEAT_SECONDS = 90
export const MOOD_START = 50
export const TIMEOUT_MOOD_PENALTY = 5
export const CALLBACK_AT = 65
export const MAYBE_AT = 40

export type Verdict = 'callback' | 'maybe' | 'no_callback'

export interface HotSeatCard {
  id: string
  term: string
  definition: string
}

export interface KlpVerdict {
  klpId: string
  text: string
  weight: number
  status: 'passed' | 'partial' | 'failed'
}

export interface HotSeatTurn {
  cardId: string
  answer: string | null
  verdicts: KlpVerdict[] | null
  /** The point the probe targets, if a probe was issued. */
  probeKlpId: string | null
  probeQuestion: string | null
  probeAnswer: string | null
  probeRecovered: boolean | null
  timedOut: boolean
  /** Mood lost on the main answer, so a recovery can restore half of it. */
  moodLost: number
}

export interface HotSeatState {
  cards: HotSeatCard[]
  index: number
  mood: number
  turns: HotSeatTurn[]
  phase: 'asking' | 'grading' | 'probing' | 'probe-grading' | 'reviewing' | 'done'
}

export function pickHotSeatCards(cards: readonly HotSeatCard[], seed: number, n = HOT_SEAT_QUESTIONS): HotSeatCard[] {
  return shuffle(cards, mulberry32(seed)).slice(0, n)
}

export function createHotSeat(cards: HotSeatCard[]): HotSeatState {
  return {
    cards,
    index: 0,
    mood: MOOD_START,
    turns: cards.map((c) => ({
      cardId: c.id,
      answer: null,
      verdicts: null,
      probeKlpId: null,
      probeQuestion: null,
      probeAnswer: null,
      probeRecovered: null,
      timedOut: false,
      moodLost: 0,
    })),
    phase: cards.length === 0 ? 'done' : 'asking',
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

/** + Σ weight of passed, − Σ weight of failed; partial counts half each way. */
export function moodDelta(verdicts: readonly KlpVerdict[]): { gained: number; lost: number } {
  let gained = 0
  let lost = 0
  for (const v of verdicts) {
    if (v.status === 'passed') gained += v.weight
    else if (v.status === 'failed') lost += v.weight
    else {
      gained += v.weight / 2
      lost += v.weight / 2
    }
  }
  return { gained, lost }
}

/** The heaviest failed point, or the heaviest partial if nothing failed — what the probe targets. */
export function probeTarget(verdicts: readonly KlpVerdict[]): KlpVerdict | null {
  const failed = verdicts.filter((v) => v.status === 'failed').sort((a, b) => b.weight - a.weight)
  if (failed[0]) return failed[0]
  const partial = verdicts.filter((v) => v.status === 'partial').sort((a, b) => b.weight - a.weight)
  return partial[0] ?? null
}

export type HotSeatAction =
  | { type: 'submit'; answer: string; timedOut: boolean }
  | { type: 'graded'; verdicts: KlpVerdict[] }
  | { type: 'probe'; klpId: string; question: string }
  | { type: 'probe-submit'; answer: string }
  | { type: 'probe-graded'; recovered: boolean }
  | { type: 'skip-probe' }
  | { type: 'next' }

export function reduceHotSeat(s: HotSeatState, a: HotSeatAction): HotSeatState {
  if (s.phase === 'done') return s
  const turn = s.turns[s.index]
  const setTurn = (patch: Partial<HotSeatTurn>) => s.turns.map((t, i) => (i === s.index ? { ...t, ...patch } : t))

  switch (a.type) {
    case 'submit': {
      if (s.phase !== 'asking') return s
      // A timeout still accepts the answer; it just costs a little mood.
      const mood = a.timedOut ? clamp(s.mood - TIMEOUT_MOOD_PENALTY) : s.mood
      return { ...s, mood, phase: 'grading', turns: setTurn({ answer: a.answer, timedOut: a.timedOut }) }
    }
    case 'graded': {
      if (s.phase !== 'grading') return s
      const { gained, lost } = moodDelta(a.verdicts)
      const mood = clamp(s.mood + gained - lost)
      const target = probeTarget(a.verdicts)
      return {
        ...s,
        mood,
        turns: setTurn({ verdicts: a.verdicts, moodLost: lost }),
        phase: target ? 'probing' : 'reviewing',
      }
    }
    case 'probe': {
      if (s.phase !== 'probing') return s
      // One probe per question: a second `probe` on the same turn is ignored.
      if (turn.probeQuestion !== null) return s
      return { ...s, turns: setTurn({ probeKlpId: a.klpId, probeQuestion: a.question }) }
    }
    case 'probe-submit': {
      if (s.phase !== 'probing' || turn.probeQuestion === null) return s
      return { ...s, phase: 'probe-grading', turns: setTurn({ probeAnswer: a.answer }) }
    }
    case 'probe-graded': {
      if (s.phase !== 'probe-grading') return s
      const mood = a.recovered ? clamp(s.mood + turn.moodLost / 2) : s.mood
      return { ...s, mood, phase: 'reviewing', turns: setTurn({ probeRecovered: a.recovered }) }
    }
    case 'skip-probe': {
      if (s.phase !== 'probing') return s
      return { ...s, phase: 'reviewing' }
    }
    case 'next': {
      if (s.phase !== 'reviewing') return s
      const index = s.index + 1
      return index >= s.cards.length ? { ...s, index, phase: 'done' } : { ...s, index, phase: 'asking' }
    }
  }
}

export function verdictFor(mood: number): Verdict {
  if (mood >= CALLBACK_AT) return 'callback'
  if (mood >= MAYBE_AT) return 'maybe'
  return 'no_callback'
}

/** The plain-text transcript the end screen offers to copy. */
export function transcript(s: HotSeatState, persona: { name: string }): string {
  const lines: string[] = []
  s.turns.forEach((t, i) => {
    const card = s.cards[i]
    lines.push(`Q${i + 1}. ${persona.name}: ${card.term}`)
    lines.push(`You: ${t.answer ?? '(no answer)'}${t.timedOut ? ' [time]' : ''}`)
    for (const v of t.verdicts ?? []) lines.push(`  ${v.status === 'passed' ? '✓' : v.status === 'partial' ? '½' : '✗'} ${v.text}`)
    if (t.probeQuestion) {
      lines.push(`${persona.name}: ${t.probeQuestion}`)
      lines.push(`You: ${t.probeAnswer ?? '(no reply)'}${t.probeRecovered === null ? '' : t.probeRecovered ? ' [recovered]' : ' [still missing]'}`)
    }
    lines.push('')
  })
  lines.push(`Mood ${Math.round(s.mood)} — ${verdictFor(s.mood).replace('_', ' ')}`)
  return lines.join('\n')
}
