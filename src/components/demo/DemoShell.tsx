'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useGuestState } from '@/lib/demo/use-guest-state'
import { DEMO_FEATURES } from '@/lib/demo/config'
import { SITE_NAME } from '@/lib/site'
import { triesUsed } from './allowance'
import { WaitlistPrompt } from './WaitlistPrompt'

export function DemoShell({ children }: { children: React.ReactNode }) {
  const [state, , loaded] = useGuestState()
  const [promptOpen, setPromptOpen] = useState(false)
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Link href="/demo" className="text-base font-semibold">
            {SITE_NAME}
          </Link>
          <Badge variant="secondary">Demo</Badge>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {loaded ? `Demo · ${triesUsed(state)} of ${DEMO_FEATURES.length} tries used` : 'Demo'}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setPromptOpen(true)}>
            Request an invite
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <WaitlistPrompt open={promptOpen} onOpenChange={setPromptOpen} reason="invite" />
    </div>
  )
}
