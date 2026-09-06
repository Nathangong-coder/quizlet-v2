import { describe, it, expect } from 'vitest'
import { AI_TASKS } from '@/lib/ai/model-routing'

/**
 * `modelFor`/`MODEL_FALLBACKS`/`DEFAULT_AI_MODEL`/`AiModel` were removed in
 * Stage 6 Task 8: the model now comes from `AiTaskRouting.model ??
 * credential.defaultModel`, resolved per-credential inside `generateJson`
 * (src/lib/ai/generate.ts). A hardcoded fallback chain here would be
 * unreachable dead code. All that remains worth pinning is the task
 * vocabulary itself, since several modules (generateJson, the AiTaskRouting
 * actions, TaskRoutingPanel) must agree on exactly these six strings.
 *
 * `AiTask` is a `(typeof AI_TASKS)[number]` derived type, not a separately
 * declared one — there is no independent type to drift out of sync with the
 * runtime array, so there is nothing to assert about it beyond "this file
 * compiles" (Fix round 1, reviewer finding #5: a prior version of this test
 * asserted exactly that and could never fail).
 *
 * `author` (Stage 8 rebuild, Spec 2) is the seventh: authoring is
 * judgment-heavy and runs rarely, runtime grading is latency-sensitive and
 * runs constantly, so they get separate routing decisions.
 */
describe('AI_TASKS', () => {
  it('contains exactly the nine expected task names', () => {
    expect(AI_TASKS).toEqual([
      'grade',
      'plan',
      'distractors',
      'autocomplete',
      'klp-extract',
      'concept-tree',
      'note-analysis',
      'diagnostic',
      'author',
    ])
  })

  /**
   * `klp-extract` and `concept-tree` were carved out of `autocomplete`, which
   * had been doing four jobs — card autofill plus three background passes that
   * write persisted knowledge. One task meant one routing decision for all of
   * them, so pinning autofill to a cheap model quietly downgraded KLP
   * extraction, and the per-task benchmark averaged work with nothing in common.
   */
  it('keeps background generation separate from card autofill', () => {
    expect(AI_TASKS).toContain('klp-extract')
    expect(AI_TASKS).toContain('concept-tree')
  })
})
