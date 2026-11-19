import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SynapseLogo } from '@/components/shell/SynapseLogo'

/**
 * The frame around the account pages — sign in, sign up, check your email,
 * forgot / reset password, verify.
 *
 * Those routes sit outside both the `(marketing)` and `(app)` groups, so they
 * render under the root layout alone: no header, and before this frame no way
 * back to the site except the browser's back button (owner, 2026-11-18). This
 * is deliberately lighter than MarketingHeader — a visitor on these pages is
 * mid-task, so the bar offers exactly one way out (home) and no menus that
 * would pull them away from the form.
 *
 * NO DATA FETCHING and no client code: it renders for every anonymous hit.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" aria-label="synapseHQ home" className="shrink-0">
            <SynapseLogo id="auth" className="h-8 w-auto text-foreground" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
