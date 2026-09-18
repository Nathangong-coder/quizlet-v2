import type { AiTask } from '@/lib/ai/model-routing'
import type { ReasoningEffort } from '@/lib/ai/providers'

/**
 * The DEFAULT provider order per task — what a learner gets with no
 * `AiTaskRouting` pin of their own. Set from measurement, not preference
 * (`npm run bench-models`, docs/ai/model-performance.md, 2026-09-15):
 *
 *  - DeepSeek grades best (separation 0.65 against GLM's 0.53-0.57 and a
 *    third measurement at 0.44), so every judgment task prefers it.
 *  - GLM at `low` effort writes the best distractors measured (94% judged
 *    genuinely wrong vs DeepSeek's 89%) at the same price, so the writing
 *    tasks — distractors, game pieces, the Hot Seat follow-up, autocomplete —
 *    prefer it.
 *  - The concept tree is a wash (GLM keeps the label rule 100%, DeepSeek 88%;
 *    DeepSeek is faster); DeepSeek first for determinism in a SHARED tree.
 *  - Authoring: GLM at `high` writes at 0.70 with no daily cap; Gemini 3.6
 *    at 0.80 is the quality reference but rationed to 20 calls a day.
 *
 * A pin still wins outright. This only orders the pool that remains; own
 * keys still come before borrowed ones (`PoolInput.group`), and inside each
 * group this rank is applied before least-recently-used. Google sits last
 * everywhere because its free tier is rate-limited by the hour ("high
 * demand" failed every benchmark call) and its models are policed.
 */
export const TASK_PROVIDER_PREFERENCE: Record<AiTask, readonly string[]> = {
  grade: ['deepseek', 'zai', 'google'],
  diagnostic: ['deepseek', 'zai', 'google'],
  'klp-extract': ['deepseek', 'zai', 'google'],
  'note-analysis': ['deepseek', 'zai', 'google'],
  plan: ['deepseek', 'zai', 'google'],
  'concept-tree': ['deepseek', 'zai', 'google'],
  // Form requirements are judgments about the question, not writing (spec 5 §5).
  'form-reqs': ['deepseek', 'zai', 'google'],
  author: ['zai', 'google', 'deepseek'],
  // The benchmark adversary WRITES calibrated answers (spec 5 §8): writer family.
  'grader-panel': ['zai', 'deepseek', 'google'],
  distractors: ['zai', 'deepseek', 'google'],
  'game-pieces': ['zai', 'deepseek', 'google'],
  'hot-seat': ['zai', 'deepseek', 'google'],
  autocomplete: ['zai', 'deepseek', 'google'],
}

/** Lower is preferred; providers not listed for the task rank after every listed one, in their existing order. */
export function providerRank(task: AiTask, provider: string): number {
  const i = TASK_PROVIDER_PREFERENCE[task].indexOf(provider)
  return i === -1 ? TASK_PROVIDER_PREFERENCE[task].length : i
}

/**
 * GLM's reasoning effort by task. `low` everywhere a learner is waiting —
 * the default effort took 30-40 s a call and spent most of its tokens
 * thinking, for +0.04 separation. Authoring runs in the background and
 * measured 0.70 at `high` against 0.60 at the default, so it gets `high`.
 * The grader benchmark panel is authoring-grade writing on the same footing
 * — four deliberately calibrated answers per card, written once, nobody
 * waiting — so it gets `high` too.
 */
const HIGH_EFFORT_TASKS: ReadonlySet<AiTask> = new Set<AiTask>(['author', 'grader-panel'])

export function zaiEffortForTask(task: AiTask): ReasoningEffort {
  return HIGH_EFFORT_TASKS.has(task) ? 'high' : 'low'
}
