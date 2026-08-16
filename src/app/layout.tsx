import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/Navbar'
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
const fraunces = Fraunces({
  subsets: ['latin'],
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
  title: 'Quizlet v2',
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
      <body className="bg-background text-foreground min-h-screen font-sans">
        <ThemeProvider>
          <Navbar />
          <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
          {/* Follows the app theme rather than defaulting to light. */}
          <Toaster richColors closeButton theme="system" />
        </ThemeProvider>
      </body>
    </html>
  )
}
