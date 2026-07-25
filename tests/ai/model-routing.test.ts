import { describe, it, expect } from 'vitest'
import { modelFor, MODEL_FALLBACKS } from '@/lib/ai/model-routing'

describe('modelFor', () => {
  it('routes grade and plan tasks to the strongest model in the chain', () => {
    expect(modelFor('grade')).toBe('gemini-3-flash')
    expect(modelFor('plan')).toBe('gemini-3-flash')
  })

  it('routes autocomplete and distractors tasks to a cheaper tier', () => {
    expect(modelFor('autocomplete')).toBe('gemini-3.1-flash-lite')
    expect(modelFor('distractors')).toBe('gemini-3.1-flash-lite')
  })

  it('every primary model returned is a real member of MODEL_FALLBACKS', () => {
    const tasks = ['grade', 'plan', 'autocomplete', 'distractors'] as const
    for (const task of tasks) {
      expect(MODEL_FALLBACKS).toContain(modelFor(task))
    }
  })

  it('MODEL_FALLBACKS matches the litellm_config.yaml fallback chain order', () => {
    expect(MODEL_FALLBACKS).toEqual([
      'gemini-3-flash',
      'gemma-4-31b-it',
      'gemini-3.1-flash-lite',
      'gemma-3-27b-it',
      'gemma-3-12b-it',
    ])
  })
})
