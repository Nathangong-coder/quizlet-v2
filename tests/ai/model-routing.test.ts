import { describe, it, expect } from 'vitest'
import { AI_TASKS, type AiTask } from '@/lib/ai/model-routing'

/**
 * `modelFor`/`MODEL_FALLBACKS`/`DEFAULT_AI_MODEL`/`AiModel` were removed in
 * Stage 6 Task 8: the model now comes from `AiTaskRouting.model ??
 * credential.defaultModel`, resolved per-credential inside `generateJson`
 * (src/lib/ai/generate.ts). A hardcoded fallback chain here would be
 * unreachable dead code. All that remains worth pinning is the task
 * vocabulary itself, since several modules (generateJson, the AiTaskRouting
 * actions, TaskRoutingPanel) must agree on exactly these four strings.
 */
describe('AI_TASKS', () => {
  it('contains exactly the four expected task names', () => {
    expect(AI_TASKS).toEqual(['grade', 'plan', 'distractors', 'autocomplete'])
  })

  it('matches the AiTask type', () => {
    // Compile-time check: every AI_TASKS member must be assignable to AiTask
    // and vice versa. If this file still compiles, the type and the runtime
    // array haven't drifted apart.
    const fromType: AiTask[] = [...AI_TASKS]
    const backToTasks: (typeof AI_TASKS)[number][] = fromType
    expect(backToTasks).toEqual(AI_TASKS)
  })
})
