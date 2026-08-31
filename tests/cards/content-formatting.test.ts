import { describe, expect, it } from 'vitest'
import { computeContentHash, ContentBlockSchema, getNumberedListIndex, type ContentBlock } from '@/lib/cards/content'

describe('rich card text formatting', () => {
  it('accepts structured list and indentation metadata', () => {
    expect(ContentBlockSchema.parse({
      id: 'block-1', type: 'text', side: 'term', text: 'Primary point', position: 0,
      listType: 'bullet', indent: 2,
    })).toMatchObject({ listType: 'bullet', indent: 2 })
  })

  it('rejects unsupported list types and excessive indentation', () => {
    expect(() => ContentBlockSchema.parse({ id: 'block-1', type: 'text', side: 'term', text: 'x', position: 0, listType: 'checklist' })).toThrow()
    expect(() => ContentBlockSchema.parse({ id: 'block-1', type: 'text', side: 'term', text: 'x', position: 0, indent: 7 })).toThrow()
  })

  it('numbers list items independently of paragraphs and media blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Context', position: 0, listType: null },
      { type: 'image', assetId: 'asset-1', position: 1 },
      { type: 'text', text: 'First step', position: 2, listType: 'numbered' as const },
      { type: 'text', text: 'Second step', position: 3, listType: 'numbered' as const },
    ]

    expect(getNumberedListIndex(blocks, 2)).toBe(0)
    expect(getNumberedListIndex(blocks, 3)).toBe(1)
  })

  it('invalidates the content hash when formatting changes', () => {
    const base: ContentBlock = { type: 'text', text: 'Point', position: 0, listType: null, indent: 0 }
    expect(computeContentHash([base])).not.toBe(computeContentHash([{ ...base, listType: 'bullet' }]))
    expect(computeContentHash([base])).not.toBe(computeContentHash([{ ...base, indent: 1 }]))
  })
})
