import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { cn } from '@/lib/utils'
import { ThemeProvider } from '@/components/theme/ThemeProvider'

/**
 * "Ledger" type system — see
 * docs/superpowers/specs/2026-08-15-design-system-and-scope-redesign-design.md §4.1.
 *
 * Three faces with three jobs, where there was previously one face doing all
 * three. Fraunces carries hierarchy that size-and-weight alone could not;
 * Plex Mono exists because this app's dominant content is NUMBERS (confidence
 * 1-10, posteriors, percentages, counts) and proportional figures shift columns
 * as values change.
 *
 * `display: 'swap'` on all three: the alternative (FOIT) hides text entirely
 * while a font loads.
 */
/**
 * `axes` is NOT optional decoration here — without it Fraunces downloads with
 * `wght` only, and SOFT / WONK / opsz are simply absent from the file. Any
 * `font-variation-settings` or `font-optical-sizing` naming them is then a rule
 * that silently does nothing, which is exactly what shipped: `globals.css` had
 * carried a dead `font-optical-sizing: auto` on every heading since the Ledger
 * work, because `opsz` was never requested.
 *
 * WONK is the axis that gives Fraunces its character (the "wonky" g, the
 * flared terminals); opsz is what stops a 52px display size from looking like
 * a blown-up body face. Requesting them is what makes the display serif read
 * as a CHOICE rather than as a default.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'SOFT', 'WONK'],
  variable: '--font-fraunces',
  display: 'swap',
})

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'synapseHQ',
  description: 'Finance interview prep — flashcards, matching, AI grading',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes writes the theme class onto <html> before paint, which React
    // sees as a server/client mismatch without this.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(fraunces.variable, plexSans.variable, plexMono.variable)}
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
        </ThemeProvider>
      </body>
    </html>
  )
}
