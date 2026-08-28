import { describe, it, expect } from 'vitest'
import {
  shadeForKnowledge,
  SHADE_CLASS,
  SHADE_LABEL,
  MASTERY_SHADES,
  type MasteryShade,
} from '@/lib/klt/mastery-shade'

describe('shadeForKnowledge', () => {
  it('maps null to `unknown`, NEVER to `weak`', () => {
    // THE assertion this module exists for. Null means no KLP under that
    // concept cleared the observation floor — no evidence, which is a different
    // claim from bad evidence. The obvious `knowledge ?? 0` paints every
    // untouched concept in the alarm colour, so a freshly authored set renders
    // as a wall of red before a single question has been answered, and the
    // learner correctly concludes the shading is noise.
    expect(shadeForKnowledge(null)).toBe('unknown')
    expect(shadeForKnowledge(null)).not.toBe('weak')
  })

  it('treats a MEASURED zero as weak, not unknown', () => {
    // The other half of the same rule. Being measured at zero is real
    // information; only the absence of measurement is unknown. Collapsing the
    // two directions would hide genuinely failing concepts.
    expect(shadeForKnowledge(0)).toBe('weak')
  })

  it('never returns `unknown` for any real number', () => {
    for (const k of [0, 0.01, 0.35, 0.5, 0.6, 0.85, 0.99, 1]) {
      expect(shadeForKnowledge(k), `knowledge ${k}`).not.toBe('unknown')
    }
  })

  it('returns unknown for NaN rather than a misleading band', () => {
    // NaN compares false against every bound, so an unguarded version would
    // fall through to `strong` — the single most flattering answer available,
    // produced by an arithmetic error.
    expect(shadeForKnowledge(Number.NaN)).toBe('unknown')
  })

  it('places each band and treats every boundary as exclusive at the top', () => {
    expect(shadeForKnowledge(0.34)).toBe('weak')
    expect(shadeForKnowledge(0.35)).toBe('developing')
    expect(shadeForKnowledge(0.59)).toBe('developing')
    expect(shadeForKnowledge(0.6)).toBe('solid')
    expect(shadeForKnowledge(0.84)).toBe('solid')
    expect(shadeForKnowledge(0.85)).toBe('strong')
    expect(shadeForKnowledge(1)).toBe('strong')
  })

  it('is monotonic — more knowledge never shades weaker', () => {
    const order: MasteryShade[] = [...MASTERY_SHADES]
    let previous = -1
    for (let k = 0; k <= 1.0001; k += 0.01) {
      const index = order.indexOf(shadeForKnowledge(Math.min(k, 1)))
      expect(index, `knowledge ${k} fell off the scale`).toBeGreaterThanOrEqual(0)
      expect(index, `knowledge ${k} shaded weaker than the value below it`).toBeGreaterThanOrEqual(previous)
      previous = index
    }
  })
})

describe('shade presentation', () => {
  it('gives every shade a class and a label', () => {
    for (const shade of [...MASTERY_SHADES, 'unknown' as const]) {
      expect(SHADE_CLASS[shade], `${shade} class`).toBeTruthy()
      expect(SHADE_LABEL[shade], `${shade} label`).toBeTruthy()
    }
  })

  it('renders `unknown` as an outline rather than a fill', () => {
    // A grey FILL inside a scale that also contains colours reads as a low
    // value ON that scale — "nearly nothing" rather than "not measured". That
    // is the same misreading `knowledge ?? 0` produces, arrived at through the
    // palette instead of through the arithmetic.
    expect(SHADE_CLASS.unknown).toContain('border-dashed')
    expect(SHADE_CLASS.unknown).toContain('bg-transparent')
  })

  it('says "not measured" rather than naming a level', () => {
    expect(SHADE_LABEL.unknown.toLowerCase()).toContain('not measured')
  })

  it('uses theme tokens, never raw colour values', () => {
    // A hardcoded hex ignores the theme and turns unreadable in dark mode —
    // the rule node-style.ts already follows for stored node colours.
    for (const cls of Object.values(SHADE_CLASS)) {
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(cls).not.toMatch(/\b(rgb|hsl|oklch)\(/)
    }
  })
})
