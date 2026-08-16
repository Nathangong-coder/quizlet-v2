'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Makes the `.dark` token set reachable.
 *
 * `globals.css` has carried a complete `.dark` block since the project was
 * scaffolded, but nothing ever applied the class — there was no provider, no
 * toggle, and no `prefers-color-scheme` wiring anywhere in `src`. It was dead
 * CSS, and the 7 components that hardcoded `bg-gray-50`/`border-gray-200`
 * would have rendered broken the moment it was switched on. Those are
 * converted; this makes the switch real.
 *
 * `attribute="class"` matches the `@custom-variant dark (&:is(.dark *))`
 * declaration in `globals.css` — an attribute-based selector would not match it.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // The theme is applied before paint by next-themes' inline script;
      // disabling transitions on switch stops every transition-colors element
      // on the page from animating at once, which reads as a flash.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
