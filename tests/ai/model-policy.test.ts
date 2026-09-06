import { describe, it, expect } from 'vitest';
import {
  GOOGLE_APPROVED_MODELS,
  GOOGLE_POLICY_FALLBACK,
  POLICED_TASKS,
  isPolicedTask,
  isModelAllowed,
  enforceModelPolicy,
} from '@/lib/ai/model-policy';
import { AI_TASKS } from '@/lib/ai/model-routing';

describe('the approved list', () => {
  it('is exactly the models the owner approved, on measured evidence', () => {
    // This assertion is the point of the guard, not an inconvenience: widening
    // the list is an owner decision about what may write into a learner's
    // history, so it must not happen as a side effect of some other change.
    // Each entry was verified by a real generation call (`npm run probe-models`)
    // against the diagnostic grading schema — never a listing call, and never a
    // benchmark, neither of which says anything about nested-schema compliance.
    expect([...GOOGLE_APPROVED_MODELS]).toEqual([
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      // Added 2026-09-06: graded the probe correctly in 300 output tokens and
      // 1.5s, the cheapest and fastest measured.
      'gemini-3.1-flash-lite',
    ]);
  });

  it('excludes the models that were measured and failed', () => {
    // Named explicitly so a future "just add the newest one" cannot quietly
    // re-admit something already tested and rejected. Measured 2026-09-06:
    // 3.4-flash does not exist; the Gemma instruction-tuned models cannot
    // produce a parseable object; 3.7-flash spent 4,185 output tokens where
    // 3.1-flash-lite spent 300 and still hit the ceiling.
    for (const rejected of [
      'gemini-2.5-flash',
      'gemini-3.4-flash',
      'gemini-3.7-flash',
      'gemma-4-31b-it',
      'gemma-4-26b-a4b-it',
    ]) {
      expect(GOOGLE_APPROVED_MODELS, rejected).not.toContain(rejected);
    }
  });

  it('falls back to an approved model, never to one outside its own list', () => {
    expect(GOOGLE_APPROVED_MODELS).toContain(GOOGLE_POLICY_FALLBACK);
  });

  /**
   * The pilot's evidence, pinned: gemini-2.5-flash failed structured output
   * outright (`response did not match schema`) on a card another model authored
   * cleanly. It must not creep back in.
   */
  it('excludes gemini-2.5-flash, which failed structured output in the pilot', () => {
    expect(GOOGLE_APPROVED_MODELS).not.toContain('gemini-2.5-flash');
  });
});

describe('the policed set', () => {
  /**
   * Every task is policed today. The value of asserting it is that adding a
   * task to AI_TASKS without deciding its policy becomes a test failure rather
   * than a silent exemption.
   */
  it('covers every declared task, so a new task cannot silently escape the policy', () => {
    for (const task of AI_TASKS) expect(isPolicedTask(task)).toBe(true);
    expect([...POLICED_TASKS].sort()).toEqual([...AI_TASKS].sort());
  });
});

describe('isModelAllowed', () => {
  it('accepts an approved Google model', () => {
    expect(isModelAllowed('google', 'gemini-3.6-flash', 'grade')).toBe(true);
  });

  it('rejects an unapproved Google model on a policed task', () => {
    expect(isModelAllowed('google', 'gemini-2.5-flash', 'grade')).toBe(false);
    expect(isModelAllowed('google', 'gemini-3.8-flash', 'author')).toBe(false);
  });

  /**
   * THE OUTAGE THIS AVOIDS. The approved list is a list of GOOGLE ids, so
   * policing every provider with it would reject every Anthropic and OpenAI
   * model the moment one is added — turning a quality floor into a total
   * failure for exactly the credits the owner is about to buy.
   */
  it('never restricts a non-Google provider', () => {
    expect(isModelAllowed('openai', 'gpt-5.2', 'grade')).toBe(true);
    expect(isModelAllowed('anthropic', 'claude-opus-5', 'author')).toBe(true);
    expect(isModelAllowed('openrouter', 'anything/at-all', 'distractors')).toBe(true);
    expect(isModelAllowed('custom', 'local-model', 'grade')).toBe(true);
  });
});

describe('enforceModelPolicy', () => {
  it('leaves an approved model alone', () => {
    expect(enforceModelPolicy('google', 'gemini-3.5-flash-lite', 'grade')).toEqual({
      model: 'gemini-3.5-flash-lite',
      substituted: false,
    });
  });

  /**
   * Substitution rather than refusal: a user whose credential defaults to an
   * unapproved model should get grading on a good model, not no grading at all.
   * The `substituted` flag is what lets the UI say so rather than hide it.
   */
  it('substitutes the fallback and says that it did', () => {
    expect(enforceModelPolicy('google', 'gemini-2.5-flash', 'grade')).toEqual({
      model: GOOGLE_POLICY_FALLBACK,
      substituted: true,
    });
  });

  it('passes a non-Google model through untouched', () => {
    expect(enforceModelPolicy('openai', 'gpt-5.2', 'grade')).toEqual({
      model: 'gpt-5.2',
      substituted: false,
    });
  });
});
