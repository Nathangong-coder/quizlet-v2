import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
