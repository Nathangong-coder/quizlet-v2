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
