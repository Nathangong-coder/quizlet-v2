import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class MockAiGenerationError extends Error {
    detail: { title: string; why: string }

    constructor(detail: { title: string; why: string }) {
      super(detail.title)
      this.name = 'AiGenerationError'
      this.detail = detail
    }
  }

  return {
    auth: vi.fn(),
    findFirst: vi.fn(),
    generateJson: vi.fn(),
    AiGenerationError: MockAiGenerationError,
  }
})

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: { set: { findFirst: h.findFirst } } }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  AiGenerationError: h.AiGenerationError,
}))

import { generateCardAutofill, getCardAutocompleteSuggestions } from '@/actions/card-autocomplete'

const SET = { title: 'M&A Basics', description: null, cards: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'user-1' } })
  h.findFirst.mockResolvedValue(SET)
})

describe('card authoring AI', () => {
  it('routes full-card autofill through the existing autocomplete task', async () => {
    h.generateJson.mockResolvedValue({ term: 'WACC', definition: 'Weighted average cost of capital.' })

    const result = await generateCardAutofill('set-1', 'WACC', '', ['valuation'])

    expect(result).toEqual({
      success: true,
      data: { term: 'WACC', definition: 'Weighted average cost of capital.' },
    })
    expect(h.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      task: 'autocomplete',
      prompt: expect.stringContaining('WACC'),
    }))
  })

  it('passes the filled side to one-sided suggestions', async () => {
    h.generateJson.mockResolvedValue({ suggestions: ['Weighted average cost of capital.'] })

    await getCardAutocompleteSuggestions('set-1', '', 'definition', ['valuation'], 'WACC')

    expect(h.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      task: 'autocomplete',
      prompt: expect.stringContaining('WACC'),
    }))
  })

  it('returns the structured no-credentials error instead of a generic suggestion error', async () => {
    h.generateJson.mockRejectedValue(new h.AiGenerationError({
      title: 'No AI provider configured',
      why: 'This feature needs an AI provider key.',
    }))

    const result = await generateCardAutofill('new', '', '', [])

    expect(result).toEqual({
      success: false,
      error: 'No AI provider configured',
      detail: {
        title: 'No AI provider configured',
        why: 'This feature needs an AI provider key.',
      },
    })
  })
})
