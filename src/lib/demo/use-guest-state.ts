'use client'

import { useCallback, useEffect, useState } from 'react'
import { emptyGuestState, loadGuestState, saveGuestState, type GuestState } from './store'

const CHANGE_EVENT = 'synapse-demo:change'

// Reads storage in an effect so server rendering never touches window. If storage
// throws, loadGuestState/saveGuestState swallow it and state lives in memory.
// `loaded` is false until that effect has run: callers render a neutral
// placeholder until then, so a returning guest never sees the empty UI flash.
// Hook instances on one page (the shell and the page body) share changes through
// a window event that carries the new state, so they agree even with no storage.
export function useGuestState(): [GuestState, (next: GuestState) => void, boolean] {
  const [state, setState] = useState<GuestState>(emptyGuestState)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setState(loadGuestState())
    setLoaded(true)
    const onChange = (e: Event) => setState((e as CustomEvent<GuestState>).detail)
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CHANGE_EVENT, onChange)
  }, [])
  const update = useCallback((next: GuestState) => {
    setState(next)
    saveGuestState(next)
    window.dispatchEvent(new CustomEvent<GuestState>(CHANGE_EVENT, { detail: next }))
  }, [])
  return [state, update, loaded]
}
