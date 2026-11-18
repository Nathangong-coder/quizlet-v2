'use client'

import { useCallback, useEffect, useState } from 'react'
import { emptyGuestState, loadGuestState, saveGuestState, type GuestState } from './store'

// Reads storage in an effect so server rendering never touches window. If storage
// throws, loadGuestState/saveGuestState swallow it and state lives in memory.
export function useGuestState(): [GuestState, (next: GuestState) => void] {
  const [state, setState] = useState<GuestState>(emptyGuestState)
  useEffect(() => {
    setState(loadGuestState())
  }, [])
  const update = useCallback((next: GuestState) => {
    setState(next)
    saveGuestState(next)
  }, [])
  return [state, update]
}
