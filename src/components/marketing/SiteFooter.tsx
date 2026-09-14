import Link from 'next/link'
import { SynapseLogo } from '@/components/shell/SynapseLogo'
import { FOOTER_COLUMNS } from '@/lib/marketing/nav'
import { CookieChoices } from '@/components/consent/CookieBanner'
import { isSignupOpen } from '@/lib/auth/signup-flag'

/**
 * The site footer: four columns from `FOOTER_COLUMNS`, the language shown as
 * a fact (English — there is no i18n, so no selector that promises
 * otherwise), cookie choices, and the copyright. Rendered under both the
 * marketing pages and the app shell.
 */
export function SiteFooter() {
  const year = new Date().getFullYear()
  // /signup calls notFound() while the flag is off, so the link goes with it.
  const signupOpen = isSignupOpen()
  const columns = FOOTER_COLUMNS.map((c) => ({ ...c, links: c.links.filter((l) => l.href !== '/signup' || signupOpen) }))
  return (
    <footer className="mt-16 border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="text-sm font-semibold">{col.heading}</h2>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          <div>
            <h2 className="text-sm font-semibold">Language</h2>
            <p className="mt-3 text-sm text-muted-foreground">English</p>
            <p className="mt-1 text-xs text-muted-foreground/80">More languages are not available yet.</p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <SynapseLogo id="footer" withWordmark={false} className="h-5 w-5 text-foreground" />
            <span>© {year} synapseHQ</span>
          </div>
          <CookieChoices />
        </div>
      </div>
    </footer>
  )
}
