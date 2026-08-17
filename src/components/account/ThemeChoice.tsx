'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The same three modes the navbar toggle cycles through, presented as an
 * explicit choice.
 *
 * A settings page and a navbar want different controls for one value: the
 * navbar has room for one icon and its job is to change the theme in a hurry,
 * so cycling is right there. Here the job is to SHOW which mode is in force and
 * let you pick another directly — a cycling button in a settings list makes you
 * click twice to see what the options even are.
 *
 * Theme is stored by `next-themes` in localStorage, so this is per-device and
 * writes nothing to the account. That is deliberate and worth the note in the
 * UI: it is the one setting on this page that does not follow you.
 */
const MODES = [
  { value: 'system', label: 'System', hint: 'Match your device', Icon: Monitor },
  { value: 'light', label: 'Light', hint: 'Always light', Icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always dark', Icon: Moon },
] as const

const NEVER_CHANGES = () => () => {}
const ON_CLIENT = () => true
const ON_SERVER = () => false

export default function ThemeChoice() {
  const { theme, setTheme } = useTheme()

  // `theme` is undefined until the client has read storage. Rendering a
  // selected state on the server would produce a hydration mismatch and could
  // show the wrong mode for a frame — same reason ThemeToggle does this.
  const mounted = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER)
  const current = mounted ? (theme ?? 'system') : 'system'

  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
      {MODES.map((mode) => {
        const selected = current === mode.value
        const { Icon } = mode
        return (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(mode.value)}
            className={cn(
              'inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-sm',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-input hover:bg-muted',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="font-medium">{mode.label}</span>
            <span className="text-xs text-muted-foreground">{mode.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
