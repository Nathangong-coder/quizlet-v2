'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Stethoscope, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The "check your understanding?" prompt on a set page (owner, 2026-09-14).
 * A small card, bottom-right, that offers the diagnostic for THIS set. Shown
 * once per set per device: dismissing it is remembered in localStorage (a
 * per-viewer convenience, not state that matters), and the server never
 * renders it for a set the viewer has already diagnosed.
 *
 * `useSyncExternalStore` over localStorage so the server and first client
 * render agree (hidden) and the card appears only after hydration.
 */
const KEY = (setId: string) => `diagnostic-prompt-dismissed:${setId}`

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}

export function DiagnosticPrompt({ setId, setTitle }: { setId: string; setTitle: string }) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(KEY(setId)) !== null
      } catch {
        return true
      }
    },
    () => true,
  )
  if (dismissed) return null

  function dismiss() {
    try {
      localStorage.setItem(KEY(setId), String(Date.now()))
    } catch {
      /* private mode — the card just comes back next time */
    }
    window.dispatchEvent(new Event('storage'))
  }

  return (
    <aside
      role="complementary"
      aria-label="Check your understanding"
      className="fixed bottom-4 right-4 z-30 w-[min(92vw,22rem)] rounded-xl border border-primary/40 bg-card p-4 shadow-[var(--shadow-md)]"
    >
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-primary/15 p-2 text-primary"><Stethoscope className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="font-heading font-bold">Check your understanding?</p>
          <p className="mt-1 text-sm text-muted-foreground">A short written diagnostic on <span className="font-medium text-foreground">{setTitle}</span> finds where you stand and seeds your memory, so your first session targets the gaps.</p>
          <div className="mt-3 flex gap-2">
            <Link href={`/diagnostic?set=${setId}`} onClick={dismiss} className={cn(buttonVariants({ size: 'sm' }))}>Take the diagnostic</Link>
            <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
          </div>
        </div>
      </div>
    </aside>
  )
}
