import { describe, it, expect } from 'vitest'
import { modelFor, MODEL_FALLBACKS, DEFAULT_AI_MODEL } from '@/lib/ai/model-routing'

/**
 * Model ids confirmed to return 200 from
 * `POST /v1beta/models/<id>:generateContent` on the Generative Language API.
 *
 * This list is the point of the suite. The previous version asserted only
 * that MODEL_FALLBACKS equalled the alias column of `litellm_config.yaml`,
 * which passed happily while three of the five ids 404'd against Google —
 * the yaml's aliases are not upstream model ids. Pinning against verified
 * ids instead means a bad id fails here rather than at runtime, mid-quiz.
 *
 * Re-verify with ListModels *and* a live generateContent call before adding
 * an entry: `gemini-2.5-flash` appears in ListModels but 404s on generation.
 */
const VERIFIED_GENERATE_CONTENT_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it',
]

/** Ids known to be rejected — regression guards against reintroducing them. */
const KNOWN_BAD_MODELS = [
  'gemini-3-flash', // a litellm alias for gemini-3-flash-preview, not a real id
  'gemma-3-27b-it', // no gemma-3 tier exists on this endpoint
  'gemma-3-12b-it',
  'gemini-2.5-flash', // lists in ListModels, 404s on generateContent
]

describe('modelFor', () => {
  it('routes grade and plan tasks to the strongest model in the chain', () => {
    expect(modelFor('grade')).toBe('gemini-3.6-flash')
    expect(modelFor('plan')).toBe('gemini-3.6-flash')
  })

  it('routes autocomplete and distractors to the cheaper tier', () => {
    // Pinned: QuizOptionCache is keyed on model id, so changing this orphans
    // every cached distractor set.
    expect(modelFor('autocomplete')).toBe('gemini-3.1-flash-lite')
    expect(modelFor('distractors')).toBe('gemini-3.1-flash-lite')
  })

  it('every primary model returned is a real member of MODEL_FALLBACKS', () => {
    const tasks = ['grade', 'plan', 'autocomplete', 'distractors'] as const
    for (const task of tasks) {
      expect(MODEL_FALLBACKS).toContain(modelFor(task))
    }
  })
})

describe('MODEL_FALLBACKS', () => {
  it('contains only model ids verified against generateContent', () => {
    for (const model of MODEL_FALLBACKS) {
      expect(VERIFIED_GENERATE_CONTENT_MODELS).toContain(model)
    }
  })

  it('does not reintroduce any id known to be rejected by the API', () => {
    for (const bad of KNOWN_BAD_MODELS) {
      expect(MODEL_FALLBACKS).not.toContain(bad)
    }
  })

  it('has no duplicates, so a failure never retries the same model', () => {
    expect(new Set(MODEL_FALLBACKS).size).toBe(MODEL_FALLBACKS.length)
  })

  it('offers at least one fallback after the primary for every task', () => {
    const tasks = ['grade', 'plan', 'autocomplete', 'distractors'] as const
    for (const task of tasks) {
      const primary = modelFor(task)
      expect(MODEL_FALLBACKS.filter((m) => m !== primary).length).toBeGreaterThan(0)
    }
  })

  it('uses a default model that is itself in the chain', () => {
    expect(MODEL_FALLBACKS).toContain(DEFAULT_AI_MODEL)
  })
})
