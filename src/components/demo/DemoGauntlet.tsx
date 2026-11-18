'use client'

import { useMemo, useState } from 'react'
import { GauntletGame } from '@/components/games/GauntletGame'
import { WaitlistPrompt, type WaitlistReason } from '@/components/demo/WaitlistPrompt'
import { makeDemoGauntletApi } from '@/lib/demo/game-adapters'
import { markUsed } from '@/lib/demo/store'
import { useGuestState } from '@/lib/demo/use-guest-state'

/**
 * The demo's Gauntlet: the real game over the demo actions; a used-up run opens
 * the waitlist prompt. A started run, or the server saying the run is spent,
 * marks it used in the guest's local allowance. An ip_limit or demo_cap refusal
 * opens the prompt but never marks it: the guest was not served.
 */
export function DemoGauntlet({ setId }: { setId: string }) {
  const [, update] = useGuestState()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<WaitlistReason>('invite')
  const api = useMemo(() => {
    // Functional updates: these run after an await, against the current record.
    const spend = () => update((current) => markUsed(current, 'gauntlet'))
    const base = makeDemoGauntletApi((r) => {
      if (r === 'quota_used') spend()
      setReason(r)
      setOpen(true)
    })
    return {
      ...base,
      buildRun: async (...args: Parameters<typeof base.buildRun>) => {
        const res = await base.buildRun(...args)
        if (res.success) spend()
        return res
      },
    }
  }, [update])
  return (
    <>
      <GauntletGame setId={setId} signedIn={false} api={api} aiLabel="Demo · AI-written options, one run" />
      <WaitlistPrompt open={open} onOpenChange={setOpen} reason={reason} />
    </>
  )
}
