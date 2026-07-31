import { describe, it, expect } from 'vitest'
import { createQuestionTimer } from '../../src/lib/quiz/question-timer'

/** Controllable clock, so elapsed times are exact rather than approximate. */
function fakeClock(start = 1000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('createQuestionTimer', () => {
  it('does not reset a question clock when it is revisited', () => {
    const clock = fakeClock()
    const timer = createQuestionTimer(clock.now)

    timer.start('c1')
    clock.advance(5000)
    timer.start('c1') // revisit — must not restart
    expect(timer.elapsed('c1')).toBe(5000)
  })

  it('times each question independently', () => {
    const clock = fakeClock()
    const timer = createQuestionTimer(clock.now)

    timer.start('c1')
    clock.advance(3000)
    timer.start('c2')
    clock.advance(1000)

    expect(timer.elapsed('c1')).toBe(4000)
    expect(timer.elapsed('c2')).toBe(1000)
  })

  it('reports undefined for a question that was never started', () => {
    expect(createQuestionTimer().elapsed('never')).toBeUndefined()
  })

  it('is non-destructive: reading elapsed twice reports the same figure', () => {
    const clock = fakeClock()
    const timer = createQuestionTimer(clock.now)

    timer.start('c1')
    clock.advance(2000)
    expect(timer.elapsed('c1')).toBe(2000)
    expect(timer.elapsed('c1')).toBe(2000)
  })
})
