'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { DEMO_STORE_KEY, emptyGuestState, loadGuestState, saveGuestState, type GuestState } from './store'

// The guest's state as an external store (the useState + useEffect spelling is a
// lint error here: react-hooks/set-state-in-effect). The server snapshot is the
// empty state and `loaded` is false there, so server rendering never touches
// window and callers render a neutral placeholder until the client has read
// storage — a returning guest never sees the empty UI flash.
//
// One module-level record serves every hook instance on the page (the shell and
// the page body), so they agree even with no storage. It is keyed by the raw
// stored string: a snapshot re-parses only when storage changed underneath it,
// and returns the same object otherwise (useSyncExternalStore needs that). When
// storage throws, the record is the state — it lives in memory for the page.

const BLOCKED = Symbol('storage blocked')
type Raw = string | null | typeof BLOCKED

const SERVER_STATE = emptyGuestState()
const listeners = new Set<() => void>()
let memory: { raw: Raw; state: GuestState } | null = null

function readRaw(): Raw {
  try {
    return window.localStorage.getItem(DEMO_STORE_KEY)
  } catch {
    return BLOCKED
  }
}

function snapshot(): GuestState {
  const raw = readRaw()
  if (memory && memory.raw === raw) return memory.state
  memory = { raw, state: raw === BLOCKED ? emptyGuestState() : loadGuestState() }
  return memory.state
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEMO_STORE_KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

const NEVER_CHANGES = () => () => {}
const ON_CLIENT = () => true
const ON_SERVER = () => false

export function useGuestState(): [GuestState, (next: GuestState) => void, boolean] {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER_STATE)
  const loaded = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER)
  const update = useCallback((next: GuestState) => {
    saveGuestState(next)
    // Key the record to whatever storage now holds: the new string when the
    // write landed, BLOCKED or the old string when it did not — either way the
    // page keeps `next` until storage itself changes.
    memory = { raw: readRaw(), state: next }
    for (const l of listeners) l()
  }, [])
  return [state, update, loaded]
}
