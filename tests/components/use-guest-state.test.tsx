// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useGuestState } from '@/lib/demo/use-guest-state'
import { markUsed } from '@/lib/demo/store'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useGuestState', () => {
  it('is not loaded on first render, then loaded', async () => {
    const { result } = renderHook(() => useGuestState())
    await waitFor(() => expect(result.current[2]).toBe(true))
  })

  it('a functional update reads the current shared record, not a stale render', async () => {
    window.localStorage.clear()
    const { result } = renderHook(() => useGuestState())
    await waitFor(() => expect(result.current[2]).toBe(true))
    const stale = result.current[0]
    const update = result.current[1]
    act(() => update(markUsed(stale, 'grade')))
    // A late callback holding the old render's state still keeps 'grade'.
    act(() => update((current) => markUsed(current, 'autocomplete')))
    expect(result.current[0].used).toEqual({ grade: true, autocomplete: true })
    window.localStorage.clear()
  })

  it('loads and keeps state in memory when localStorage throws', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useGuestState())
    await waitFor(() => expect(result.current[2]).toBe(true))
    act(() => result.current[1](markUsed(result.current[0], 'grade')))
    expect(result.current[0].used.grade).toBe(true)
  })
})
