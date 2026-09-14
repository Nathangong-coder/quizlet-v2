'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { useConsent } from '@/lib/consent/use-consent'
import { analyticsAllowed } from '@/lib/consent/consent'

// Loaded only once consent says so, and never in the initial bundle.
const Analytics = dynamic(() => import('@vercel/analytics/next').then((m) => m.Analytics), { ssr: false })

/**
 * The consent banner and the analytics gate, together, because they are
 * one decision: analytics mounts ONLY once the visitor has chosen "all".
 *
 * Small and honest. The app sets one essential cookie (sign-in) and nothing
 * else; analytics is cookieless but still tracking, so it is opt-in.
 * "Essential only" is a real choice that keeps working forever, and the
 * footer's "Cookie choices" reopens this to change it.
 *
 * Renders nothing until the browser has read storage (server snapshot is
 * `undefined`), so there is no flash and no hydration mismatch.
 */
export function CookieBanner() {
  const [consent, decide] = useConsent()
  if (consent === undefined) return null

  return (
    <>
      {analyticsAllowed(consent) && <Analytics />}
      {consent === null && (
        <div
          role="region"
          aria-label="Cookie choices"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border border-border bg-card p-4 text-sm shadow-[var(--shadow-md)] sm:inset-x-6 sm:bottom-6"
        >
          <p className="font-medium">Cookies, briefly.</p>
          <p className="mt-1 text-muted-foreground">
            One essential cookie keeps you signed in. If you allow it, we also count visits with privacy-friendly, cookieless analytics — no ads, nothing sold.{' '}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">Privacy policy</Link>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => decide('all')}>Allow analytics</Button>
            <Button size="sm" variant="outline" onClick={() => decide('essential')}>Essential only</Button>
          </div>
        </div>
      )}
    </>
  )
}

/** The footer's "Cookie choices" control: shows the current choice and lets it change. */
export function CookieChoices() {
  const [consent, decide, reset] = useConsent()
  if (consent === undefined) return <span className="text-muted-foreground">Cookie choices</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span>Cookie choices:</span>
      <span className="text-muted-foreground">{consent === null ? 'not decided' : consent.choice === 'all' ? 'analytics allowed' : 'essential only'}</span>
      {consent?.choice === 'all' ? (
        <button type="button" onClick={() => decide('essential')} className="underline underline-offset-4 hover:text-foreground">turn analytics off</button>
      ) : consent ? (
        <button type="button" onClick={() => decide('all')} className="underline underline-offset-4 hover:text-foreground">allow analytics</button>
      ) : (
        <button type="button" onClick={reset} className="underline underline-offset-4 hover:text-foreground">choose</button>
      )}
    </span>
  )
}
