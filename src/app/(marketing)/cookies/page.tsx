import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/marketing/LegalPage'
import { CookieChoices } from '@/components/consent/CookieBanner'

export const metadata: Metadata = {
  title: 'Cookie notice',
  description: 'The one cookie synapseHQ sets, the optional analytics, and how to change your choice.',
}

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie notice" updated="13 September 2026">
      <p>This is short because there is not much to say.</p>

      <h2>What we set</h2>
      <ul>
        <li>
          <strong>One essential cookie</strong> — the session cookie that keeps you signed in. It is set when you sign in, is HTTP-only, and expires when your session does. Without it the app cannot know who you are, so it needs no consent and cannot be turned off.
        </li>
      </ul>

      <h2>What we set only if you allow it</h2>
      <ul>
        <li>
          <strong>Analytics</strong> — Vercel Analytics counts page views. It sets no cookie and does not identify you; it is still tracking, so it is off until you allow it in the banner.
        </li>
      </ul>

      <h2>What we do not set</h2>
      <p>No advertising cookies, no third-party trackers, no cross-site anything.</p>

      <h2>Browser storage</h2>
      <p>
        We keep a few things in your browser&rsquo;s local storage, which is not a cookie and never leaves your device: your theme, your cookie choice, and your best scores in games.
      </p>

      <h2>Your choice</h2>
      <p className="rounded-lg border border-border bg-card p-4 text-sm"><CookieChoices /></p>

      <p className="text-sm text-muted-foreground">More in the <Link href="/privacy">privacy policy</Link>.</p>
    </LegalPage>
  )
}
