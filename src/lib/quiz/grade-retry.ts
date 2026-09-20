/**
 * D6 (Spec 5): a short-answer grade whose reply failed the strict schema is
 * retried ONCE in place; a second failure throws, the answer records
 * `analysisStatus: 'failed'`, and the out-of-vocabulary label — when that is
 * what the schema rejected — is written beside it.
 *
 * Pure predicates over the thrown error's shape. `generateJsonWithMeta`
 * throws an `AiGenerationError` whose `detail.attempts[]` aggregates EVERY
 * credential tried (surfacing only the last was what made an earlier
 * multi-key outage unreadable), so the decision reads the whole list. Typed
 * structurally rather than importing `AiGenerationError`, so this module
 * stays free of the generation stack.
 */

interface FailureShape {
  detail?: { attempts?: Array<{ kind?: string }>; value?: unknown };
}

function kindsOf(err: unknown): string[] {
  const attempts = (err as FailureShape | undefined)?.detail?.attempts;
  if (!attempts) return [];
  return attempts.map((a) => a.kind).filter((k): k is string => typeof k === 'string');
}

/**
 * Retry the SAME call once?
 *
 * Yes when some credential's reply failed the schema (`schema_invalid`) — a
 * malformed reply is the one failure the same call genuinely fixes, and a
 * pool where another key hit its daily cap beside it costs that key nothing
 * it still had.
 *
 * NEVER when the ceiling was hit (`output_truncated`, a `finishReason:
 * 'length'`): the same call again runs out of the same room. That is a
 * problem for `src/lib/analysis/output-cap.ts`, not for a retry — and it is
 * checked FIRST, so a pool that both truncated and misformatted is not sent
 * back into the ceiling.
 *
 * Nothing else is retried: an exhausted quota, a missing key, a provider
 * outage — asking again does not make an absent key present.
 */
export function shouldRetryGradeInPlace(err: unknown): boolean {
  const kinds = kindsOf(err);
  if (kinds.includes('output_truncated')) return false;
  return kinds.includes('schema_invalid');
}

/**
 * The out-of-vocabulary value a strict enum rejected, when the failure
 * carried one (`AiGenerationError.detail.value`, set by
 * `extractUnknownEnumValue` in the generation layer). Undefined otherwise.
 */
export function unknownValueOf(err: unknown): string | undefined {
  const value = (err as FailureShape | undefined)?.detail?.value;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * D6: the grading call, retried ONCE in place when `shouldRetryGradeInPlace`
 * says so. The second failure propagates to the caller, which records the
 * failed row.
 *
 * On a MIXED retry — the first reply carried an out-of-vocabulary label and
 * the second failed some other way (a quota, an outage) with no value — the
 * thrown error is made to carry `unknownValueOf(second) ?? unknownValueOf(first)`.
 * The failed row's `unknownStatus` exists to record what label the grader
 * invented, and the first attempt is the only one that knows. The second
 * failure is still what propagates: its kinds decide the classification;
 * only the value is inherited, and only when it has none of its own.
 */
export async function gradeWithOneRetry<T>(call: () => Promise<T>): Promise<T> {
  let first: unknown;
  try {
    return await call();
  } catch (err) {
    if (!shouldRetryGradeInPlace(err)) throw err;
    first = err;
  }
  console.warn('Short-answer grade failed the schema; retrying once in place (D6).');
  try {
    return await call();
  } catch (second) {
    const inherited = unknownValueOf(first);
    if (
      inherited !== undefined &&
      unknownValueOf(second) === undefined &&
      second !== null &&
      typeof second === 'object'
    ) {
      const shaped = second as FailureShape;
      shaped.detail = { ...(shaped.detail ?? {}), value: inherited };
    }
    throw second;
  }
}
