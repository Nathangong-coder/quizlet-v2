import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unfenceJson } from '@/lib/ai/providers'

/**
 * Every provider this app can use MUST be configured to send the JSON schema.
 *
 * `createOpenAICompatible` defaults `supportsStructuredOutputs` to FALSE, and
 * when it is false the SDK silently DROPS the schema from the request: the
 * model is asked for "some JSON" with no shape, returns free-form output, and
 * Zod rejects it. That surfaces as `schema_invalid`, which reads as "this
 * model is bad at schemas" rather than "we never sent it one".
 *
 * Measured 2026-09-06 against OpenRouter: the SDK logged
 * `The feature "responseFormat" is not supported` and the probe failed on a
 * model that does support structured output. Every generation in this app goes
 * through `Output.object({ schema })`, so this is not an optimisation — it is
 * the contract.
 *
 * A source check because the alternative is a live provider call in CI.
 */
describe('openai-compatible providers', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'lib', 'ai', 'providers.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n')

  it('enables structured outputs on the openai-compatible path', () => {
    expect(source).toMatch(/createOpenAICompatible\(\{[\s\S]*?supportsStructuredOutputs:\s*true/)
  })

  it('explains why, so nobody removes it as noise', () => {
    expect(source).toContain('DROPPED from the request')
  })
})

/**
 * DeepSeek fences its structured output when strict is off.
 *
 * Measured 2026-09-07: an authoring call returned `finishReason: 'stop'`, zero
 * reasoning tokens and a COMPLETE object — inside a ```json fence. The SDK
 * raises `NoObjectGeneratedError` for that, which reads as "this model cannot
 * hold a schema" and is why an earlier pass went looking at token budgets.
 */
describe('unfenceJson', () => {
  it('unwraps a ```json fence around a valid object', () => {
    expect(unfenceJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('unwraps a bare ``` fence', () => {
    expect(unfenceJson('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('leaves unfenced JSON exactly as it is', () => {
    expect(unfenceJson('{"a":1}')).toBe('{"a":1}')
  })

  it('does NOT rewrite a fence whose contents are not JSON', () => {
    // The guard that stops this being the old stripMarkdownJson regex: prose
    // must be passed through to fail honestly, not mangled into something that
    // fails later and somewhere else.
    const prose = '```\nI cannot answer that.\n```'
    expect(unfenceJson(prose)).toBe(prose)
  })

  it('leaves a string that merely CONTAINS a fence alone', () => {
    const value = '{"note":"use ```json for code"}'
    expect(unfenceJson(value)).toBe(value)
  })

  it('survives an unterminated fence without throwing', () => {
    const truncated = '```json\n{"a":1'
    expect(unfenceJson(truncated)).toBe(truncated)
  })
})
