import { describe, expect, it } from 'vitest'
import { nextTheme } from '@/components/theme/ThemeToggle'

describe('nextTheme', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('treats an unresolved or unknown theme as the start of the cycle', () => {
    // `theme` is undefined until next-themes has read storage, so this is the
    // real first-click case, not an edge case. It falls out of the modulo
    // rather than a guard: `(-1 + 1) % 3` is 0. Pinned here because that is a
    // property of the arithmetic, and reordering or extending MODES could
    // silently change it.
    expect(nextTheme(undefined)).toBe('system')
    expect(nextTheme('')).toBe('system')
    expect(nextTheme('sepia')).toBe('system')
  })

  it('visits every mode within one full cycle', () => {
    const seen = new Set<string>()
    let mode = 'system'
    for (let i = 0; i < 3; i++) {
      mode = nextTheme(mode)
      seen.add(mode)
    }
    expect(seen).toEqual(new Set(['system', 'light', 'dark']))
  })
})
