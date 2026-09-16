'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { CONSENT_STORAGE_KEY, parseConsent, serializeConsent, type ConsentChoice, type ConsentRecord } from './consent'

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => { if (e.key === CONSENT_STORAGE_KEY) cb() }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage) }
}
function readRaw(): string | null {
  try { return window.localStorage.getItem(CONSENT_STORAGE_KEY) } catch { return null }
}

/**
 * The consent record as a store. Server snapshot is `undefined` — "not
 * known yet" — distinct from `null` — "known: never decided" — so the banner
 * renders nothing during SSR/hydration and only appears once the browser
 * has actually looked. No flash, no mismatch.
 */
export function useConsent(): [ConsentRecord | null | undefined, (choice: ConsentChoice) => void, () => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => undefined)
  const decide = useCallback((choice: ConsentChoice) => {
    try { window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent(choice)) } catch { /* banner stays; nothing else breaks */ }
    for (const l of listeners) l()
  }, [])
  const reset = useCallback(() => {
    try { window.localStorage.removeItem(CONSENT_STORAGE_KEY) } catch { /* ignore */ }
    for (const l of listeners) l()
  }, [])
  return [raw === undefined ? undefined : parseConsent(raw), decide, reset]
}
