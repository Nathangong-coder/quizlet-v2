import type { AiTask } from '@/lib/ai/model-routing'

/**
 * Sampling temperature per AI task.
 *
 * WHY THIS EXISTS. Nothing in this codebase set a temperature until
 * 2026-09-06, so every call ran at the provider default — 1.0 on Gemini, full
 * creative sampling — including grading, extraction and every other structured
 * judgment. That is a configuration for writing prose, not for deciding whether
 * an answer covers a proposition.
 *
 * The cost was measured, not theorised. A grader handed a vacuous answer has
 * one fact to report and no more; once it has reported it, the distribution
 * over "what comes next" is flat, and at temperature 1.0 the model samples
 * honestly from that flat mess. Two failures follow:
 *
 *  - It restates itself, and each restatement makes the next more likely
 *    because the context now looks like a document that repeats things. One
 *    such loop reached 15,001 output tokens and returned no parseable object,
 *    losing a whole graded sitting.
 *  - It drifts across scripts, because a low-probability token is no longer
 *    effectively excluded. A stored grade for the answer "IDK" ends
 *    "...future cash inflows.智慧," — Chinese for "wisdom", sampled after the
 *    sentence had already ended.
 *
 * Low temperature does not merely make output shorter; it restores the stop
 * token's advantage over the noise, which is what ends generation.
 *
 * REPEATABILITY IS A FEATURE HERE, not a side effect. Two learners giving the
 * same answer to the same key point should get the same verdict, and the same
 * learner re-reading a report should see what they saw before.
 */
const TASK_TEMPERATURE: Record<AiTask, number> = {
  // Pure judgment. The grade must not depend on the sampler's mood.
  grade: 0,
  diagnostic: 0,
  // Extraction and authoring: reading propositions out of source text. There
  // is a right answer; variety is noise.
  'klp-extract': 0,
  author: 0,
  'note-analysis': 0,
  // Placement and summarising in a SHARED tree, where an edit moves everyone's
  // topic mastery. Determinism matters more here than anywhere.
  'concept-tree': 0,
  /**
   * The two tasks where variety is the point, and both are deliberately low
   * rather than zero.
   *
   * Distractors: four options that are all the obvious wrong answer make a
   * worse question, so some spread helps. But a distractor is generated ONCE
   * and cached per (card, model), so the same learner never sees it re-rolled
   * — the spread wanted is across cards, which a small temperature already
   * gives.
   */
  distractors: 0.3,
  /** Autocomplete offers several suggestions at once; identical ones are useless. */
  autocomplete: 0.4,
  /** A plan is prose over a fixed set of facts. Some phrasing latitude, no invention. */
  plan: 0.2,
}

/**
 * The temperature a task should run at.
 *
 * Total over `AiTask` by construction, so adding a task is a type error rather
 * than a silent fall back to the provider default — which is exactly how every
 * call in this codebase ended up at 1.0.
 */
export function temperatureForTask(task: AiTask): number {
  return TASK_TEMPERATURE[task]
}
