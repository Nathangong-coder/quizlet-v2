import { describe, it, expect } from 'vitest'
import { temperatureForTask } from '@/lib/ai/temperature'
import { AI_TASKS } from '@/lib/ai/model-routing'

describe('temperatureForTask', () => {
  it('is total over AI_TASKS — no task falls back to the provider default', () => {
    // The provider default is 1.0 on Gemini, and running a judgment task there
    // is what produced a 15,001-token repetition loop and Chinese characters
    // appended after a finished English sentence. A missing entry must be a
    // type error, not a silent 1.0.
    for (const task of AI_TASKS) {
      expect(typeof temperatureForTask(task), task).toBe('number')
    }
  })

  it('grades deterministically', () => {
    // Two learners giving the same answer to the same key point must get the
    // same verdict, and a learner re-reading a report must see what they saw.
    expect(temperatureForTask('grade')).toBe(0)
    expect(temperatureForTask('diagnostic')).toBe(0)
  })

  it('extracts and authors deterministically', () => {
    // Reading propositions out of source text has a right answer; variety is
    // noise, and a superseded KLP resets mastery.
    expect(temperatureForTask('klp-extract')).toBe(0)
    expect(temperatureForTask('author')).toBe(0)
    expect(temperatureForTask('concept-tree')).toBe(0)
  })

  it('never exceeds a low ceiling, even where variety is wanted', () => {
    // Distractors and autocomplete want spread, but nothing here wants the
    // creative-writing default.
    for (const task of AI_TASKS) {
      expect(temperatureForTask(task), task).toBeLessThanOrEqual(0.5)
    }
  })

  it('gives the two variety tasks more room than the judgment ones', () => {
    expect(temperatureForTask('autocomplete')).toBeGreaterThan(temperatureForTask('grade'))
    expect(temperatureForTask('distractors')).toBeGreaterThan(temperatureForTask('grade'))
  })
})
