import { describe, it, expect } from 'vitest'
import { shouldRetryGradeInPlace, unknownValueOf } from '@/lib/quiz/grade-retry'

/** An AiGenerationError-shaped failure: `detail.attempts[].kind` is what is read. */
function aiFailure(kinds: string[], value?: string) {
  return Object.assign(new Error(kinds.join(',')), {
    detail: { attempts: kinds.map((kind) => ({ kind })), value },
  })
}

describe('shouldRetryGradeInPlace (D6)', () => {
  it('retries once when the reply failed the schema', () => {
    expect(shouldRetryGradeInPlace(aiFailure(['schema_invalid']))).toBe(true)
  })

  it('retries when any credential in the pool failed the schema', () => {
    // A pool where one key hit its daily cap and another returned garbage:
    // the garbage is worth one more try; the retry costs the capped key
    // nothing it still had.
    expect(shouldRetryGradeInPlace(aiFailure(['quota_exhausted', 'schema_invalid']))).toBe(true)
  })

  it('does NOT retry in place when the ceiling was hit', () => {
    // `output_truncated` means the model ran out of room — the same call
    // again runs out of the same room. That is a ceiling problem
    // (src/lib/analysis/output-cap.ts), not a compliance problem.
    expect(shouldRetryGradeInPlace(aiFailure(['output_truncated']))).toBe(false)
    expect(shouldRetryGradeInPlace(aiFailure(['schema_invalid', 'output_truncated']))).toBe(false)
  })

  it('does not retry any other failure', () => {
    for (const kind of ['quota_exhausted', 'invalid_key', 'no_credentials', 'provider_down', 'rate_limited', 'internal']) {
      expect(shouldRetryGradeInPlace(aiFailure([kind]))).toBe(false)
    }
  })

  it('treats a bare Error as not retryable', () => {
    expect(shouldRetryGradeInPlace(new Error('boom'))).toBe(false)
    expect(shouldRetryGradeInPlace(undefined)).toBe(false)
  })
})

describe('unknownValueOf', () => {
  it('reads the out-of-vocabulary label the strict enum rejected', () => {
    expect(unknownValueOf(aiFailure(['schema_invalid'], 'bogus_label'))).toBe('bogus_label')
  })

  it('is undefined when the failure carried no value', () => {
    expect(unknownValueOf(aiFailure(['schema_invalid']))).toBeUndefined()
    expect(unknownValueOf(new Error('boom'))).toBeUndefined()
  })
})
