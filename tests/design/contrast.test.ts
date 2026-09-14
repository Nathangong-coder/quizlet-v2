import { describe, it, expect } from 'vitest'
import { audit, contrast } from '../../scripts/contrast-audit'

/**
 * WCAG contrast on the design tokens, both themes, as a build gate. The
 * pairs live in scripts/contrast-audit.ts; add one there when a new colour
 * combination appears in the UI. The decorative hairline border is reported
 * but not gated (it carries no information).
 */
describe('design token contrast', () => {
  it('computes the WCAG ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#ffffff', '#ffffff')).toBe(1)
  })

  it('every text and UI-boundary pair passes in both themes', () => {
    const { rows, failed } = audit()
    const failures = rows.filter((r) => !r.ok && r.min >= 3).map((r) => `${r.theme}: ${r.pair} = ${r.ratio} (min ${r.min})`)
    expect(failures).toEqual([])
    expect(failed).toBe(0)
  })
})
