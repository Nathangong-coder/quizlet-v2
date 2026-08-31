import type { Metadata } from 'next'
import { IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { cn } from '@/lib/utils'
import { ThemeProvider } from '@/components/theme/ThemeProvider'

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
        </ThemeProvider>
      </body>
    </html>
  )
}
