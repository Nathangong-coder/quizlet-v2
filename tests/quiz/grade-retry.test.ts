import { describe, it, expect, vi } from 'vitest'
import { shouldRetryGradeInPlace, unknownValueOf, gradeWithOneRetry } from '@/lib/quiz/grade-retry'

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

describe('gradeWithOneRetry', () => {
  it('returns the first result when the call succeeds', async () => {
    const call = vi.fn().mockResolvedValue('ok')
    await expect(gradeWithOneRetry(call)).resolves.toBe('ok')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('retries exactly once on a schema failure and returns the second result', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(aiFailure(['schema_invalid'], 'bogus'))
      .mockResolvedValueOnce('ok')
    await expect(gradeWithOneRetry(call)).resolves.toBe('ok')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('does not retry a failure that is not retryable', async () => {
    const call = vi.fn().mockRejectedValue(aiFailure(['output_truncated']))
    await expect(gradeWithOneRetry(call)).rejects.toBeDefined()
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('on a mixed retry, the thrown error carries unknownValueOf(second) ?? unknownValueOf(first)', async () => {
    // First reply: an out-of-vocabulary label (the value worth recording on
    // the failed row). Second: the provider fell over, no value. The row must
    // still say what label the grader invented — that is the whole reason
    // `unknownStatus` exists — so the first failure's value survives.
    const first = aiFailure(['schema_invalid'], 'sorta_right')
    const second = aiFailure(['provider_down'])
    const call = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second)
    let thrown: unknown
    try {
      await gradeWithOneRetry(call)
    } catch (err) {
      thrown = err
    }
    expect(call).toHaveBeenCalledTimes(2)
    expect(unknownValueOf(thrown)).toBe('sorta_right')
    // The second failure is what propagates — its kinds decide the row's
    // classification — only the value is inherited.
    expect(thrown).toBe(second)
  })

  it("the second failure's own value wins when it has one", async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(aiFailure(['schema_invalid'], 'first_label'))
      .mockRejectedValueOnce(aiFailure(['schema_invalid'], 'second_label'))
    await expect(gradeWithOneRetry(call)).rejects.toSatisfy((e: unknown) => unknownValueOf(e) === 'second_label')
  })
})
