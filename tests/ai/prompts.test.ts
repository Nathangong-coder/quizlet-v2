import { describe, it, expect } from 'vitest'
import type { Card } from '@prisma/client'
import { MULTIPLE_CHOICE_PROMPT } from '@/lib/ai/prompts/multiple-choice'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { ANNOTATION_PROMPT } from '@/lib/ai/prompts/annotation'
import { TRAINING_PLAN_PROMPT } from '@/lib/ai/prompts/training-plan'
import { QUIZ_SUMMARY_PROMPT } from '@/lib/ai/prompts/quiz-summary'
import { MC_FEEDBACK_PROMPT } from '@/lib/ai/prompts/mc-feedback'
import { AUTOCOMPLETE_PROMPT } from '@/lib/ai/prompts/autocomplete'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    term: 'EBITDA',
    definition: 'Earnings before interest, taxes, depreciation, and amortization.',
    position: 0,
    setId: 'set-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Card
}

const PROFILE_BLOCK = 'Learner snapshot (set: "M&A Basics")\nWeak (conf<=4): "synergies" (3, flat)'

describe('MULTIPLE_CHOICE_PROMPT', () => {
  const card = makeCard()
  const sibling = makeCard({ id: 'card-2', term: 'WACC', definition: 'Weighted average cost of capital.' })

  it('build() works without a profileBlock and includes the core prompt content', () => {
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [card, sibling] })
    expect(prompt).toContain('EBITDA')
    expect(prompt).toContain(card.definition)
    expect(prompt).toContain(sibling.definition)
    expect(prompt).not.toContain('recent performance')
  })

  it('build() interpolates the profileBlock as a distractor hint when provided', () => {
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [card, sibling], profileBlock: PROFILE_BLOCK })
    expect(prompt).toContain(PROFILE_BLOCK)
    expect(prompt).toContain("recent performance")
  })

  it('buildParts() returns parts + matching promptText, with profileBlock included', () => {
    const { parts, promptText } = MULTIPLE_CHOICE_PROMPT.buildParts({
      card,
      promptBlocks: [{ type: 'text', text: 'x', position: 0 } as any],
      siblingCards: [card, sibling],
      profileBlock: PROFILE_BLOCK,
    })
    expect(parts).toEqual([{ text: promptText }])
    expect(promptText).toContain(PROFILE_BLOCK)
  })
})

describe('GRADE_SHORT_ANSWER_PROMPT', () => {
  const card = makeCard()

  it('build() omits profileBlock context when not supplied (no crash, no stray label)', () => {
    const prompt = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'Profit before non-cash and financing items.' })
    expect(prompt).toContain('Grade the following short-answer response')
    expect(prompt).not.toContain('Learner context')
  })

  it('build() prepends "Learner context: ..." when a profileBlock is supplied', () => {
    const prompt = GRADE_SHORT_ANSWER_PROMPT.build({
      card,
      answer: 'Profit before non-cash and financing items.',
      profileBlock: PROFILE_BLOCK,
    })
    expect(prompt.startsWith(`Learner context: ${PROFILE_BLOCK}`)).toBe(true)
  })

  it('keeps the rubric schema/JSON shape identical regardless of profileBlock', () => {
    const withBlock = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', profileBlock: PROFILE_BLOCK })
    const withoutBlock = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x' })
    for (const p of [withBlock, withoutBlock]) {
      expect(p).toContain('"clarity"')
      expect(p).toContain('"conciseness"')
      expect(p).toContain('"correctness"')
      expect(p).toContain('"overall"')
    }
  })
})

describe('ANNOTATION_PROMPT', () => {
  it('build() works with and without a profileBlock', () => {
    const card = makeCard()
    const withBlock = ANNOTATION_PROMPT.build({ card, answer: 'x', correct: card.definition, profileBlock: PROFILE_BLOCK })
    const withoutBlock = ANNOTATION_PROMPT.build({ card, answer: 'x', correct: card.definition })
    expect(withBlock).toContain(PROFILE_BLOCK)
    expect(withoutBlock).not.toContain('Learner context')
  })
})

describe('TRAINING_PLAN_PROMPT', () => {
  it('build() works with no profileBlock (fresh user, no memory yet)', () => {
    const prompt = TRAINING_PLAN_PROMPT.build({})
    expect(prompt).toContain('personalized training plan')
    expect(prompt).not.toContain('Learner context')
  })

  it('build() injects the profileBlock as learner context', () => {
    const prompt = TRAINING_PLAN_PROMPT.build({ profileBlock: PROFILE_BLOCK })
    expect(prompt).toContain(`Learner context: ${PROFILE_BLOCK}`)
  })
})

describe('QUIZ_SUMMARY_PROMPT', () => {
  it('build() renders answers and score, with and without profileBlock', () => {
    const input = {
      setTitle: 'M&A Basics',
      mode: 'multiple-choice',
      score: 80,
      answers: [{ term: 'EBITDA', isCorrect: true, score: 100, feedback: 'Nice.' }],
    }
    const withoutBlock = QUIZ_SUMMARY_PROMPT.build(input)
    const withBlock = QUIZ_SUMMARY_PROMPT.build({ ...input, profileBlock: PROFILE_BLOCK })

    expect(withoutBlock).toContain('M&A Basics')
    expect(withoutBlock).toContain('EBITDA')
    expect(withBlock).toContain(`Learner context: ${PROFILE_BLOCK}`)
  })
})

describe('MC_FEEDBACK_PROMPT and AUTOCOMPLETE_PROMPT (no memory injection)', () => {
  it('MC_FEEDBACK_PROMPT.build() has no profileBlock parameter in its documented use', () => {
    const card = makeCard()
    const prompt = MC_FEEDBACK_PROMPT.build({ card, selected: 'A', correct: card.definition })
    expect(prompt).toContain('finance interview grader')
  })

  it('AUTOCOMPLETE_PROMPT.build() renders set/category context', () => {
    const prompt = AUTOCOMPLETE_PROMPT.build({
      set: { title: 'M&A Basics', description: null, cards: [] },
      currentText: 'accre',
      side: 'term',
      categories: ['valuation'],
    })
    expect(prompt).toContain('M&A Basics')
    expect(prompt).toContain('valuation')
  })
})

describe('PROMPT_REGISTRY', () => {
  it('every entry has a stable id/version and a build function', () => {
    for (const [id, entry] of Object.entries(PROMPT_REGISTRY)) {
      expect(entry.id).toBe(id)
      expect(typeof entry.version).toBe('number')
      expect(typeof entry.build).toBe('function')
      expect(entry.schema).toBeDefined()
    }
  })
})
