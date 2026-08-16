import { describe, it, expect } from 'vitest'
import { printQuizHref } from '@/components/quiz/QuizSetupScreen'
import type { QuizSetup } from '@/lib/quiz/setup'

const BASE: QuizSetup = {
  questionMode: ['multiple-choice'],
  promptSide: 'term',
  categoryIds: [],
  starredOnly: false,
  failedOnly: false,
  printable: false,
  questionCount: 10,
}

const params = (setup: QuizSetup) =>
  new URLSearchParams(printQuizHref('set-1', setup).split('?')[1])

describe('printQuizHref: the filters reach the printed test', () => {
  it('carries categories, starred and failed', () => {
    // THE BUG. The URL used to carry modes/side/count only, and the print page
    // typed exactly those four keys and read every card in the set — so a
    // learner who ticked "Starred Only" plus two categories got a printable
    // test over the whole set, with nothing saying the filters were dropped.
    const p = params({
      ...BASE,
      categoryIds: ['c1', 'c2'],
      starredOnly: true,
      failedOnly: true,
    })
    expect(p.get('cats')).toBe('c1,c2')
    expect(p.get('starred')).toBe('1')
    expect(p.get('failed')).toBe('1')
  })

  it('still carries the three it always did', () => {
    const p = params({
      ...BASE,
      questionMode: ['multiple-choice', 'true-false'],
      promptSide: 'mixed',
      questionCount: 25,
    })
    expect(p.get('modes')).toBe('multiple-choice,true-false')
    expect(p.get('side')).toBe('mixed')
    expect(p.get('count')).toBe('25')
  })

  it('omits an unset filter rather than sending a falsy one', () => {
    // `starred=0` reads as a filter that is set. The print page tests for '1',
    // but an absent key is the honest encoding of "not filtering".
    const p = params(BASE)
    expect(p.has('starred')).toBe(false)
    expect(p.has('failed')).toBe(false)
    expect(p.has('cats')).toBe(false)
  })

  it('targets the set it was given', () => {
    expect(printQuizHref('set-9', BASE).startsWith('/sets/set-9/print?')).toBe(true)
  })
})
