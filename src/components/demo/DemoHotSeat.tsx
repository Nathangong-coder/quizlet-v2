'use client'

import { useMemo, useState } from 'react'
import { HotSeatGame } from '@/components/games/HotSeatGame'
import { WaitlistPrompt } from '@/components/demo/WaitlistPrompt'
import { makeDemoHotSeatApi } from '@/lib/demo/game-adapters'

/** The demo's Hot Seat: the real game, normal difficulty, over the demo actions. */
export function DemoHotSeat({ setId }: { setId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const api = useMemo(() => makeDemoHotSeatApi((r) => { setReason(r); setOpen(true) }), [])
  return (
    <>
      <HotSeatGame setId={setId} signedIn={false} api={api} lockedMode="normal" aiLabel="Demo · AI interviewer, one run" />
      <WaitlistPrompt open={open} onOpenChange={setOpen} reason={reason} />
    </>
  )
}
