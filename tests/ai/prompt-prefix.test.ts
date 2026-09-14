import { describe, it, expect } from 'vitest'
import { GRADE_CANDIDATE_PROMPT } from '@/lib/ai/prompts/grade-candidate'
import { WRITE_REBUILD_PROMPT, GRADE_COVERAGE_PROMPT, GRADE_PARITY_PROMPT } from '@/lib/ai/prompts/rebuild'
import { REVIEW_REFERENCE_PROMPT, REVIEW_REBUILT_PROMPT, REVISE_REFERENCE_PROMPT } from '@/lib/ai/prompts/review-reference'
import { REVISE_KLPS_PROMPT } from '@/lib/ai/prompts/revise-klps'
import { RELATE_KLPS_PROMPT } from '@/lib/ai/prompts/relate-klps'
import { CLASSIFY_ROLES_PROMPT } from '@/lib/ai/prompts/classify-roles'
import { CLASSIFY_ABSTRACTION_PROMPT } from '@/lib/ai/prompts/classify-abstraction'
import { WRITE_ADVERSARIES_PROMPT } from '@/lib/ai/prompts/write-adversaries'

/**
 * THE PREFIX-CACHE GUARD (2026-09-14). DeepSeek bills a cache hit only for
 * the leading tokens that exactly match an earlier request, in 64-token
 * blocks. Across the first corpus 75% of input tokens missed because every
 * prompt reached its card-specific content within its first ~40 tokens, so
 * nothing was shared between cards. Every prompt below now opens with its
 * static instructions; this test pins that no card-specific text appears
 * inside the first PREFIX_CHARS characters, which is comfortably more than
 * one cache block. A prompt that fails here has been reordered back.
 */
const PREFIX_CHARS = 400
const Q = '§QUESTION§', D = '§DEFINITION§', R = '§REFERENCE§', C = '§CANDIDATE§', K = '§POINT§', A = '§ANSWER§'
const sentinels = [Q, D, R, C, K, A]

const builds: [string, () => string][] = [
  ['grade-candidate', () => GRADE_CANDIDATE_PROMPT.build({ question: Q, referenceAnswer: R, klps: [{ text: K, kind: 'causal' }], candidateAnswer: C, strict: true })],
  ['write-rebuild', () => WRITE_REBUILD_PROMPT.build({ question: Q, klps: [{ text: K }] })],
  ['grade-coverage', () => GRADE_COVERAGE_PROMPT.build({ question: Q, definitionPoints: [{ point: K }], rebuiltAnswer: A, strict: true })],
  ['grade-parity', () => GRADE_PARITY_PROMPT.build({ question: Q, referenceAnswer: R, rebuiltAnswer: A, strict: true })],
  ['review-reference', () => REVIEW_REFERENCE_PROMPT.build({ question: Q, answer: A, definition: D })],
  ['review-rebuilt', () => REVIEW_REBUILT_PROMPT.build({ question: Q, definition: D, rebuiltAnswer: A, klps: [{ text: K }] })],
  ['revise-reference', () => REVISE_REFERENCE_PROMPT.build({ question: Q, definition: D, referenceAnswer: R, klps: [{ text: K, kind: 'causal' }], review: { accuracy: 'hedged', conciseness: 'wordy', clarity: 'clear', issues: [] } })],
  ['revise-klps', () => REVISE_KLPS_PROMPT.build({ question: Q, klps: [{ text: K, kind: 'causal' }], discrimination: [{ index: 0, passesReference: true, failsSomeWrong: true, discriminates: true }], targetCount: 4, reason: 'r', findings: [] })],
  ['relate-klps', () => RELATE_KLPS_PROMPT.build({ question: Q, klps: [{ text: K }] })],
  ['classify-roles', () => CLASSIFY_ROLES_PROMPT.build({ question: Q, definition: D, klps: [{ text: K, kind: 'causal' }] })],
  ['classify-abstraction', () => CLASSIFY_ABSTRACTION_PROMPT.build({ question: Q, klps: [{ text: K }] })],
  ['write-adversaries', () => WRITE_ADVERSARIES_PROMPT.build({ question: Q, referenceAnswer: R })],
]

describe('every DeepSeek-facing prompt opens with a cacheable static prefix', () => {
  for (const [name, build] of builds) {
    it(`${name}: no card-specific text in the first ${PREFIX_CHARS} characters`, () => {
      const p = build()
      const first = Math.min(...sentinels.map((s) => (p.indexOf(s) < 0 ? Infinity : p.indexOf(s))))
      expect(first, `${name} reaches card content at char ${first}`).toBeGreaterThanOrEqual(PREFIX_CHARS)
      // and the same prefix for two different cards
      const p2 = p.replace(Q, 'another question')
      expect(p2.slice(0, PREFIX_CHARS)).toBe(p.slice(0, PREFIX_CHARS))
    })
  }
})
