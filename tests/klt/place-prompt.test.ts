import { describe, it, expect } from 'vitest'
import { PLACE_KLTS_PROMPT } from '@/lib/ai/prompts/place-klts'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'
import { KltPlacementSchema } from '@/lib/ai/schemas'
import { MAX_TREE_DEPTH } from '@/lib/klt/tree'

const input = { tree: 'finance\n  accounting', concepts: ['quick ratio', 'minority interest'] }

describe('PLACE_KLTS_PROMPT', () => {
  it('is in the registry', () => {
    expect(PROMPT_REGISTRY['place-klts']).toBe(PLACE_KLTS_PROMPT)
  })

  it('shows the whole tree and asks for reuse', () => {
    const out = PLACE_KLTS_PROMPT.build(input)
    expect(out).toContain('finance\n  accounting')
    expect(out).toMatch(/REUSE an existing node/)
  })

  it('says so when the tree is empty', () => {
    expect(PLACE_KLTS_PROMPT.build({ ...input, tree: '' })).toMatch(/tree is empty/)
  })

  it('lists every concept to place', () => {
    const out = PLACE_KLTS_PROMPT.build(input)
    expect(out).toContain('- quick ratio')
    expect(out).toContain('- minority interest')
  })

  it('states the depth cap it will be validated against', () => {
    expect(PLACE_KLTS_PROMPT.build(input)).toContain(`At most ${MAX_TREE_DEPTH} elements`)
  })

  it('forbids padding rather than requesting a depth', () => {
    // Demanding rungs produces filler that becomes permanent structure.
    const out = PLACE_KLTS_PROMPT.build(input)
    expect(out).toMatch(/Do NOT invent levels/)
    // Reject both hard and soft depth solicitations (e.g. "as deep as you can")
    expect(out).not.toMatch(
      /at least \d+ levels|as deep as you can|as many levels as|prefer longer paths/i,
    )
  })

  it('states the IS-A test that makes a path checkable', () => {
    expect(PLACE_KLTS_PROMPT.build(input)).toMatch(/Reading the path backwards/)
  })

  it('accepts a well-formed reply', () => {
    expect(
      KltPlacementSchema.safeParse({
        placements: [{ concept: 'quick ratio', path: ['finance', 'quick ratio'] }],
      }).success,
    ).toBe(true)
  })

  it('rejects an empty path', () => {
    expect(
      KltPlacementSchema.safeParse({ placements: [{ concept: 'x', path: [] }] }).success,
    ).toBe(false)
  })

  it('rejects an empty string inside the path', () => {
    // A blank segment would create a nameless node in the tree, which then
    // becomes a permanent parent nothing can be found under.
    expect(
      KltPlacementSchema.safeParse({
        placements: [{ concept: 'quick ratio', path: ['finance', '', 'quick ratio'] }],
      }).success,
    ).toBe(false)
  })

  it('rejects an empty concept string', () => {
    expect(
      KltPlacementSchema.safeParse({
        placements: [{ concept: '', path: ['finance', 'quick ratio'] }],
      }).success,
    ).toBe(false)
  })
})
