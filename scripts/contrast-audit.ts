/**
 * Contrast audit over the design tokens, both themes.
 *
 * Reads `src/app/globals.css` (light) and `dark-mode.css` (dark), computes
 * the WCAG 2.x contrast ratio for every foreground/background pair the UI
 * actually composes, and prints a table. Exit code 1 if any pair that
 * carries body text is under 4.5:1 or any large-text/UI pair is under 3:1.
 *
 *   npx tsx scripts/contrast-audit.ts
 *
 * Pure arithmetic over the token files — no browser, so it can run in CI.
 * Adding a pair here is how a new colour combination gets its guard.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function tokens(file: string, block: RegExp): Record<string, string> {
  const css = readFileSync(join(ROOT, file), 'utf8')
  const m = css.match(block)
  if (!m) throw new Error(`no token block in ${file}`)
  const out: Record<string, string> = {}
  for (const line of m[0].split('\n')) {
    const t = line.match(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/)
    if (t) out[t[1]] = t[2].toLowerCase()
  }
  return out
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

/** [foreground token, background token, minimum ratio, what it is] */
export const PAIRS: [string, string, number, string][] = [
  ['foreground', 'background', 4.5, 'body text on the page'],
  ['foreground', 'card', 4.5, 'body text on a card'],
  ['muted-foreground', 'background', 4.5, 'secondary text on the page'],
  ['muted-foreground', 'card', 4.5, 'secondary text on a card'],
  ['muted-foreground', 'muted', 4.5, 'secondary text on a muted surface'],
  ['primary-foreground', 'primary', 4.5, 'button label'],
  ['accent-foreground', 'accent', 4.5, 'text on the accent slab'],
  ['success', 'background', 4.5, 'success text on the page'],
  ['success', 'success-subtle', 4.5, 'success text on its subtle surface'],
  ['warning', 'background', 4.5, 'warning text on the page'],
  ['warning', 'warning-subtle', 4.5, 'warning text on its subtle surface'],
  ['destructive', 'background', 4.5, 'destructive text on the page'],
  ['primary', 'background', 4.5, 'link / primary text on the page'],
  ['primary', 'card', 4.5, 'link / primary text on a card'],
  ['sidebar-foreground', 'sidebar', 4.5, 'rail text'],
  ['border', 'background', 1.5, 'hairline border (decorative; no requirement, reported only)'],
  ['input', 'background', 3.0, 'input border (UI component, 3:1)'],
]

export function audit(): { rows: { theme: string; pair: string; ratio: number; min: number; ok: boolean; what: string }[]; failed: number } {
  // The SECOND `:root` block — the first is Tailwind's `@theme` wiring with
  // no hex values in it.
  const light = tokens('src/app/globals.css', /:root \{\s*--background: #[\s\S]*?\r?\n\}/)
  const dark = tokens('dark-mode.css', /\.dark \{[\s\S]*?\n\}/)
  const rows: { theme: string; pair: string; ratio: number; min: number; ok: boolean; what: string }[] = []
  let failed = 0
  for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
    for (const [fg, bg, min, what] of PAIRS) {
      if (!t[fg] || !t[bg]) continue
      const ratio = contrast(t[fg], t[bg])
      const ok = ratio >= min
      if (!ok && min >= 3) failed++
      rows.push({ theme, pair: `${fg} on ${bg}`, ratio: Math.round(ratio * 100) / 100, min, ok, what })
    }
  }
  return { rows, failed }
}

if (process.argv[1]?.endsWith('contrast-audit.ts')) {
  const { rows, failed } = audit()
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.theme.padEnd(5)} ${r.pair.padEnd(40)} ${String(r.ratio).padStart(5)}  (min ${r.min})  ${r.what}`)
  console.log(failed === 0 ? '\nAll pairs pass.' : `\n${failed} pair(s) under the minimum.`)
  process.exit(failed === 0 ? 0 : 1)
}
