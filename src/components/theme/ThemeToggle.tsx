'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Order defines the cycle: system -> light -> dark -> system. */
const MODES = [
  { value: 'system', label: 'System theme', Icon: Monitor },
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
] as const

export type ThemeMode = (typeof MODES)[number]['value']

/**
 * Pure, so the cycle is testable without a provider or a DOM.
 *
 * An unknown or absent theme (`theme` is undefined until next-themes has read
 * storage) yields MODES[0] for free: `findIndex` returns -1 and `(-1 + 1) % n`
 * is 0. An explicit `if (index === -1)` guard was written here first and then
 * removed — it returned MODES[0] as well, so it could never change the result
 * and no test could have detected its deletion.
 */
export function nextTheme(current: string | undefined): ThemeMode {
  const index = MODES.findIndex((m) => m.value === current)
  return MODES[(index + 1) % MODES.length].value
}

/**
 * Has the component hydrated?
 *
 * The usual `useState(false)` + `useEffect(() => setMounted(true))` spelling is
 * a LINT ERROR in this project (`react-hooks/set-state-in-effect`, cascading
 * renders), so hydration is read as an external store instead: the server
 * snapshot is `false`, the client snapshot is `true`, and nothing ever
 * notifies, so there is no subscription churn.
 */
const NEVER_CHANGES = () => () => {}
const ON_CLIENT = () => true
const ON_SERVER = () => false

export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()

  // `theme` is undefined until the client has read storage, so rendering the
  // real icon on the server would produce a hydration mismatch and could show
  // the wrong mode for a frame.
  const mounted = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER)

  const current = mounted ? (theme ?? 'system') : 'system'
  const mode = MODES.find((m) => m.value === current) ?? MODES[0]
  const { Icon } = mode

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme(current))}
      // The control is icon-only, so it needs its own name, and the name must
      // say what is CURRENT rather than what the click will do — otherwise a
      // screen-reader user cannot read the present state at all.
      aria-label={`${mode.label}. Change theme.`}
      title={`${mode.label}. Change theme.`}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
        'transition-colors hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {/* suppressHydrationWarning is not enough on its own — `mounted` above is
          what guarantees server and first client render agree. */}
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}
