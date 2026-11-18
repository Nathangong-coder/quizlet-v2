// Pure: no React, no node:crypto, no process.env. Safe for the client bundle.
import { DEMO_FEATURES, GUEST_LIMITS, type DemoFeature } from './config'
import type { SignedPoints } from './signed-points'

export const DEMO_STORE_KEY = 'synapse-demo:v1'

export type GuestCard = { id: string; term: string; definition: string; points?: SignedPoints }
export type GuestState = {
  set: { title: string; cards: GuestCard[] } | null
  quizzesStarted: number
  used: Partial<Record<DemoFeature, true>>
}

export type GuestResult =
  | { ok: true; state: GuestState }
  | { ok: false; limit: 'cards' | 'sets' | 'quizzes' }
  | { ok: false; invalid: true }

export function emptyGuestState(): GuestState {
  return { set: null, quizzesStarted: 0, used: {} }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isCard(v: unknown): v is GuestCard {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.term === 'string' &&
    typeof v.definition === 'string' &&
    (v.points === undefined || isObject(v.points))
  )
}

function parseGuestState(raw: unknown): GuestState | null {
  if (!isObject(raw)) return null
  const { set, quizzesStarted, used } = raw
  if (typeof quizzesStarted !== 'number' || !Number.isInteger(quizzesStarted) || quizzesStarted < 0) return null
  if (!isObject(used)) return null
  const cleanUsed: Partial<Record<DemoFeature, true>> = {}
  for (const f of DEMO_FEATURES) if (used[f] === true) cleanUsed[f] = true
  if (set === null) return { set: null, quizzesStarted, used: cleanUsed }
  if (!isObject(set) || typeof set.title !== 'string' || !Array.isArray(set.cards)) return null
  if (!set.cards.every(isCard)) return null
  return {
    set: { title: set.title, cards: set.cards.slice(0, GUEST_LIMITS.cards) },
    quizzesStarted,
    used: cleanUsed,
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadGuestState(storage: Storage | null = defaultStorage()): GuestState {
  try {
    if (!storage) return emptyGuestState()
    const raw = storage.getItem(DEMO_STORE_KEY)
    if (raw === null) return emptyGuestState()
    return parseGuestState(JSON.parse(raw)) ?? emptyGuestState()
  } catch {
    return emptyGuestState()
  }
}

export function saveGuestState(state: GuestState, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(DEMO_STORE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or blocked: the page keeps working in memory.
  }
}

function newCardId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createGuestSet(state: GuestState, title: string): GuestResult {
  if (state.set) return { ok: false, limit: 'sets' }
  const t = title.trim()
  if (!t) return { ok: false, invalid: true }
  return { ok: true, state: { ...state, set: { title: t, cards: [] } } }
}

export function addGuestCard(state: GuestState, input: { term: string; definition: string }): GuestResult {
  if (!state.set) return { ok: false, invalid: true }
  const term = input.term.trim()
  const definition = input.definition.trim()
  if (!term || !definition) return { ok: false, invalid: true }
  if (state.set.cards.length >= GUEST_LIMITS.cards) return { ok: false, limit: 'cards' }
  const card: GuestCard = { id: newCardId(), term, definition }
  return { ok: true, state: { ...state, set: { ...state.set, cards: [...state.set.cards, card] } } }
}

export function editGuestCard(
  state: GuestState,
  id: string,
  patch: { term?: string; definition?: string },
): GuestResult {
  if (!state.set) return { ok: false, invalid: true }
  const target = state.set.cards.find((c) => c.id === id)
  if (!target) return { ok: false, invalid: true }
  const term = (patch.term ?? target.term).trim()
  const definition = (patch.definition ?? target.definition).trim()
  if (!term || !definition) return { ok: false, invalid: true }
  // The signature binds the card text, so points do not survive an edit.
  const changed = term !== target.term || definition !== target.definition
  const cards = state.set.cards.map((c) => {
    if (c.id !== id) return c
    const edited: GuestCard = { ...c, term, definition }
    if (changed) delete edited.points
    return edited
  })
  return { ok: true, state: { ...state, set: { ...state.set, cards } } }
}

export function startGuestQuiz(state: GuestState): GuestResult {
  if (state.quizzesStarted >= GUEST_LIMITS.quizzes) return { ok: false, limit: 'quizzes' }
  return { ok: true, state: { ...state, quizzesStarted: state.quizzesStarted + 1 } }
}

export function markUsed(state: GuestState, feature: DemoFeature): GuestState {
  if (state.used[feature]) return state
  return { ...state, used: { ...state.used, [feature]: true } }
}
