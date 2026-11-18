'use client'

import { useMemo, useState } from 'react'
import { HotSeatGame } from '@/components/games/HotSeatGame'
import { WaitlistPrompt, type WaitlistReason } from '@/components/demo/WaitlistPrompt'
import { makeDemoHotSeatApi } from '@/lib/demo/game-adapters'
import { markUsed } from '@/lib/demo/store'
import { useGuestState } from '@/lib/demo/use-guest-state'

/**
 * The demo's Hot Seat: the real game, normal difficulty, over the demo actions.
 * A started run, or the server saying the run is spent, marks it used in the
 * guest's local allowance; ip_limit and demo_cap open the prompt only.
 */
export function DemoHotSeat({ setId }: { setId: string }) {
  const [, update] = useGuestState()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<WaitlistReason>('invite')
  const api = useMemo(() => {
    // Functional updates: these run after an await, against the current record.
    const spend = () => update((current) => markUsed(current, 'hot-seat'))
    const base = makeDemoHotSeatApi((r) => {
      if (r === 'quota_used') spend()
      setReason(r)
      setOpen(true)
    })
    return {
      ...base,
      start: async (...args: Parameters<typeof base.start>) => {
        const res = await base.start(...args)
        if (res.success) spend()
        return res
      },
    }
  }, [update])
  return (
    <>
      <HotSeatGame setId={setId} signedIn={false} api={api} lockedMode="normal" aiLabel="Demo · AI interviewer, one run" />
      <WaitlistPrompt open={open} onOpenChange={setOpen} reason={reason} />
    </>
  )
}
