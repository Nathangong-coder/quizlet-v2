import { describe, it, expect } from 'vitest'
import { AI_TASKS, AI_TASK_LABELS } from '@/lib/ai/model-routing'

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
 *
 * `form-reqs` (Spec 5 §5) is the twelfth: the form-requirements pass is one
 * judgment call per card over an already-authored reference, and it must not
 * ride on `author` (Z.ai-first, `high` effort) — it is grader-family work.
 *
 * `grader-panel` (Spec 5 §8) is the thirteenth: the adversary that writes
 * the benchmark panel — four answers at four intended levels, or one per
 * failure shape — is writer-family, authoring-grade work. It is not `author`
 * because a panel is written ONCE per (card, klpVersion) and re-graded on
 * every grader change, so it wants its own routing decision and its own line
 * on the usage dashboard; and it is not `grade` because the grader must
 * never be the model that wrote what it grades.
 */
describe('AI_TASKS', () => {
  it('contains exactly the thirteen expected task names', () => {
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
      'game-pieces',
      'hot-seat',
      'form-reqs',
      'grader-panel',
    ])
  })

  /**
   * `AI_TASK_LABELS` is `Record<AiTask, string>`, so a missing label is a type
   * error — but a label that is an empty string, or a slug pasted as its own
   * label, compiles. The usage dashboard and the routing panel both render
   * these, so pin that every task has a real human name.
   */
  it('has a non-empty human label for every task, distinct from the slug', () => {
    for (const task of AI_TASKS) {
      const label = AI_TASK_LABELS[task]
      expect(label, task).toBeTruthy()
      expect(label, task).not.toBe(task)
    }
    expect(Object.keys(AI_TASK_LABELS).sort()).toEqual([...AI_TASKS].sort())
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
