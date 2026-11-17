import { describe, it, expect } from 'vitest'
import { outcomeOf } from '@/components/klp/KlpGraphCanvas'

describe('outcomeOf — legacy status compatibility', () => {
  it('historical passed rows render as right, not untested', () => {
    expect(outcomeOf('passed')).toBe('right')
    expect(outcomeOf('correct')).toBe('right')
    expect(outcomeOf('incomplete')).toBe('partial')
    expect(outcomeOf('inversion')).toBe('wrong')
    expect(outcomeOf('nonsense')).toBe('untested')
  })
})
