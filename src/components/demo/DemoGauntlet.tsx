'use client'

import { useMemo, useState } from 'react'
import { GauntletGame } from '@/components/games/GauntletGame'
import { WaitlistPrompt } from '@/components/demo/WaitlistPrompt'
import { makeDemoGauntletApi } from '@/lib/demo/game-adapters'

/** The demo's Gauntlet: the real game over the demo actions; a used-up run opens the waitlist prompt. */
export function DemoGauntlet({ setId }: { setId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const api = useMemo(() => makeDemoGauntletApi((r) => { setReason(r); setOpen(true) }), [])
  return (
    <>
      <GauntletGame setId={setId} signedIn={false} api={api} aiLabel="Demo · AI-written options, one run" />
      <WaitlistPrompt open={open} onOpenChange={setOpen} reason={reason} />
    </>
  )
}
