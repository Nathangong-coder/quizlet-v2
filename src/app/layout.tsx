import type { Metadata } from 'next'
import { IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { cn } from '@/lib/utils'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION, TITLE_TEMPLATE, siteOrigin } from '@/lib/site'
import { CookieBanner } from '@/components/consent/CookieBanner'

/**
 * The UI uses the Hurme families named by the design direction. They are
 * resolved locally when available and fall back to the system sans stack in
 * environments that do not ship the webfont. Plex Mono remains reserved for
 * changing numeric values, where stable character widths help.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

/**
 * Site-wide metadata. Every page inherits the title template, description,
 * Open Graph and Twitter card; a page that sets its own `title` gets
 * "Page · synapseHQ". `metadataBase` makes the generated
 * `opengraph-image` and every relative URL absolute for crawlers.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: TITLE_TEMPLATE },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes writes the theme class onto <html> before paint, which React
    // sees as a server/client mismatch without this.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(plexMono.variable)}
    >
      {/*
        NO CHROME AND NO MEASURE HERE, deliberately.

        This layout used to render the navbar and wrap everything in
        `max-w-6xl mx-auto px-4 py-8` — and then all 17 pages applied their own
        `max-w-5xl mx-auto px-4 py-10` on top of it. Centered inside centered,
        with `px-4` twice. That was invisible only while both wrappers centered
        on the same axis; a fixed-width rail is what makes it visible.

        `src/app/(app)/layout.tsx` now owns the rail, the topbar and the measure,
        exactly once. Everything OUTSIDE that route group — the study activities
        and the auth pages — renders bare, which is the point: a timed matching
        game must not carry a nav column, and /print must be chrome-free.
      */}
      <body className="bg-background text-foreground min-h-screen font-sans">
        <ThemeProvider>
          {children}
          {/* Follows the app theme rather than defaulting to light. */}
          <Toaster richColors closeButton theme="system" />
          {/* Consent + analytics gate, on every page including the bare ones. */}
          <CookieBanner />
        </ThemeProvider>
      </body>
    </html>
  )
}
