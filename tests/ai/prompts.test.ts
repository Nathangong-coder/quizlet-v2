import { describe, it, expect } from 'vitest'
import type { Card } from '@prisma/client'
import { MULTIPLE_CHOICE_PROMPT } from '@/lib/ai/prompts/multiple-choice'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { ANNOTATION_PROMPT } from '@/lib/ai/prompts/annotation'
import { TRAINING_PLAN_PROMPT } from '@/lib/ai/prompts/training-plan'
import { MC_FEEDBACK_PROMPT } from '@/lib/ai/prompts/mc-feedback'
import { AUTOCOMPLETE_PROMPT } from '@/lib/ai/prompts/autocomplete'
import { SESSION_INSIGHT_PROMPT } from '@/lib/ai/prompts/session-insight'
import { EXTRACT_KLPS_PROMPT } from '@/lib/ai/prompts/extract-klps'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'
import { summarizeSession } from '@/lib/memory/summarize'
import { MAX_FOCUS_AREAS } from '@/lib/memory/insight'
import { KLP_KINDS } from '@/lib/ai/schemas'

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

describe('SESSION_INSIGHT_PROMPT', () => {
  const computed = summarizeSession([
    {
      cardId: 'c1',
      term: 'WACC',
      source: 'quiz-mc',
      correct: false,
      score: null,
      confidenceBefore: 5,
      confidenceAfter: 4,
      latencyMs: 900,
      categoryNames: ['Valuation'],
    },
  ])
  const input = { setTitle: 'Finance 101', kind: 'quiz', computed }

  it('includes the computed figures the model must reason from', () => {
    const prompt = SESSION_INSIGHT_PROMPT.build(input)
    expect(prompt).toContain('Finance 101')
    expect(prompt).toContain('Valuation')
    expect(prompt).toContain('WACC')
  })

  it('instructs the model not to invent numbers', () => {
    expect(SESSION_INSIGHT_PROMPT.build(input).toLowerCase()).toContain('do not calculate')
  })

  it('includes the learner profile block only when one is supplied', () => {
    const without = SESSION_INSIGHT_PROMPT.build(input)
    const withBlock = SESSION_INSIGHT_PROMPT.build({ ...input, profileBlock: PROFILE_BLOCK })
    expect(withBlock.length).toBeGreaterThan(without.length)
    expect(withBlock).toContain(PROFILE_BLOCK)
  })

  it('interpolates the focus-area cap rather than hardcoding it', () => {
    expect(SESSION_INSIGHT_PROMPT.build(input)).toContain(
      `Return up to ${MAX_FOCUS_AREAS} focus areas`,
    )
  })

  it('tells the model how to choose a severity', () => {
    const prompt = SESSION_INSIGHT_PROMPT.build(input)
    expect(prompt).toContain('severity')
    for (const level of ['high', 'medium', 'low']) {
      expect(prompt).toContain(`"${level}"`)
    }
  })
})

describe('MULTIPLE_CHOICE_PROMPT v2 (KLP-driven)', () => {
  const card = makeCard()
  const klps = [
    { ref: 0, text: 'EBITDA excludes interest expense', kind: 'definition' },
    { ref: 1, text: 'D&A is added back because it is non-cash', kind: 'causal' },
  ]

  it('is version 2', () => {
    expect(MULTIPLE_CHOICE_PROMPT.version).toBe(2)
  })

  it('lists each KLP by ref and asks for one corruption per distractor', () => {
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [], klps })
    expect(prompt).toContain('[0]')
    expect(prompt).toContain('EBITDA excludes interest expense')
    expect(prompt).toContain('klpRef')
    expect(prompt).toContain('inversion')
  })

  it('falls back to the legacy prompt when the card has no KLPs', () => {
    // A user with no AI key, or a card whose extraction failed, must still get
    // a working quiz.
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [] })
    expect(prompt).toContain('plausible but incorrect distractors')
    expect(prompt).not.toContain('klpRef')
  })

  it('falls back to the legacy prompt when klps is an empty array', () => {
    // A card whose extraction ran but returned zero KLPs must still fall
    // back cleanly rather than asking the model to corrupt an empty list.
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [], klps: [] })
    expect(prompt).toContain('plausible but incorrect distractors')
    expect(prompt).not.toContain('klpRef')
  })

  it('never leaks a cuid into the prompt', () => {
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [], klps })
    expect(prompt).not.toContain(card.id)
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

describe('EXTRACT_KLPS_PROMPT', () => {
  const input = {
    setTitle: 'M&A Basics',
    cards: [
      { ref: 0, term: 'WACC', definition: 'Weighted average cost of capital.' },
      { ref: 1, term: 'EBITDA', definition: 'Earnings before interest, taxes, D&A.' },
    ],
  }

  it('addresses cards by ref, never by id', () => {
    const prompt = EXTRACT_KLPS_PROMPT.build(input)
    expect(prompt).toContain('[0]')
    expect(prompt).toContain('[1]')
    expect(prompt).toContain('WACC')
  })

  it('demands propositions rather than topics', () => {
    // The single highest-leverage instruction in the prompt: topic-shaped KLPs
    // produce useless distractors and unmatchable error targets.
    expect(EXTRACT_KLPS_PROMPT.build(input).toLowerCase()).toContain('proposition')
  })

  it('states the atomic-card rule so short cards are not padded to 3 KLPs', () => {
    expect(EXTRACT_KLPS_PROMPT.build(input)).toContain('atomic')
  })

  it('lists every allowed kind', () => {
    const prompt = EXTRACT_KLPS_PROMPT.build(input)
    for (const kind of KLP_KINDS) expect(prompt).toContain(kind)
  })

  it('is registered with a stable id and version', () => {
    expect(EXTRACT_KLPS_PROMPT.id).toBe('extract-klps')
    expect(EXTRACT_KLPS_PROMPT.version).toBe(1)
    expect(PROMPT_REGISTRY['extract-klps']).toBe(EXTRACT_KLPS_PROMPT)
  })
})
