import { describe, it, expect } from 'vitest'
import { cardMode, modeInstruction, NATURE_FOR_MODE, CARD_MODES } from '@/lib/klp/card-mode'

describe('cardMode', () => {
  it('maps the writer question types', () => {
    expect(cardMode({ questionType: 'define', kinds: ['definition'] })).toBe('knowledge')
    expect(cardMode({ questionType: 'why', kinds: ['causal', 'causal'] })).toBe('knowledge')
    expect(cardMode({ questionType: 'compare', kinds: ['contrast'] })).toBe('knowledge')
    expect(cardMode({ questionType: 'enumerate', kinds: ['example', 'example'] })).toBe('knowledge')
    expect(cardMode({ questionType: 'calculate', kinds: ['quantitative'] })).toBe('calculation')
    expect(cardMode({ questionType: 'walkthrough', kinds: ['mechanism'] })).toBe('procedure')
  })
  it('a scenario is applied unless its points are mostly numbers (the soap card is applied)', () => {
    const soap = ['causal', 'mechanism', 'mechanism', 'causal', 'causal', 'definition', 'definition', 'example', 'example']
    expect(cardMode({ questionType: 'scenario', kinds: soap })).toBe('applied')
    expect(cardMode({ questionType: 'scenario', kinds: ['quantitative', 'quantitative', 'causal'] })).toBe('calculation')
  })
  it('with no label reads the points', () => {
    expect(cardMode({ questionType: null, kinds: ['quantitative', 'quantitative', 'definition'] })).toBe('calculation')
    expect(cardMode({ kinds: ['example', 'example', 'causal'] })).toBe('applied')
    expect(cardMode({ kinds: ['definition', 'causal'] })).toBe('knowledge')
    expect(cardMode({ kinds: [] })).toBe('knowledge')
  })
  it('every mode has a nature and an instruction', () => {
    for (const m of CARD_MODES) {
      expect(NATURE_FOR_MODE[m]).toBeDefined()
      expect(modeInstruction(m).length).toBeGreaterThan(20)
    }
    expect(NATURE_FOR_MODE.applied).toBe('skill')
  })
})
