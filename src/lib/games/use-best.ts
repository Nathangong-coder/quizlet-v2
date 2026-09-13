'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { bestKey } from './best'

const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * The device-local best for a game, as a store: the server snapshot is
 * always null (so SSR and the first client render agree and nothing
 * hydrates differently), and a write notifies every subscriber. No effect,
 * no setState-in-effect.
 */
export function useBest<T>(game: string, setId: string): [T | null, (value: T) => void] {
  const key = bestKey(game, setId)
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null)
  const write = useCallback(
    (value: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // The game still plays.
      }
      for (const l of listeners) l()
    },
    [key],
  )
  let parsed: T | null = null
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw) as T
    } catch {
      parsed = null
    }
  }
  return [parsed, write]
}
