import { describe, expect, it } from 'vitest'
import {
  computeContentHash,
  ContentBlockSchema,
  getNumberedListIndex,
  getTextMarkSegments,
  isTextMarkActive,
  remapTextMarksForTextChange,
  toggleTextMark,
  type ContentBlock,
} from '@/lib/cards/content'

describe('rich card text formatting', () => {
  it('accepts structured list and indentation metadata', () => {
    expect(ContentBlockSchema.parse({
      id: 'block-1', type: 'text', side: 'term', text: 'Primary point', position: 0,
      listType: 'bullet', indent: 2, marks: [{ start: 0, end: 7, bold: true }],
    })).toMatchObject({ listType: 'bullet', indent: 2, marks: [{ start: 0, end: 7, bold: true }] })
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

  it('restarts numbering after an unrelated block', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'First list item', position: 0, listType: 'numbered' as const },
      { type: 'text', text: 'Second list item', position: 1, listType: 'numbered' as const },
      { type: 'text', text: 'A separate paragraph', position: 2, listType: null },
      { type: 'text', text: 'New list item', position: 3, listType: 'numbered' as const },
    ]

    expect(getNumberedListIndex(blocks, 1)).toBe(1)
    expect(getNumberedListIndex(blocks, 3)).toBe(0)
  })

  it('toggles a selected inline style without disturbing other styles', () => {
    const marks = [{ start: 0, end: 5, bold: true }]
    const next = toggleTextMark(marks, 2, 8, 'highlight', 10)

    expect(next).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 5, bold: true, highlight: true },
      { start: 5, end: 8, highlight: true },
    ])
    expect(isTextMarkActive(next, 2, 8, 'highlight', 10)).toBe(true)
  })

  it('keeps inline styles attached when text is inserted inside a marked range', () => {
    const next = remapTextMarksForTextChange(
      [{ start: 0, end: 5, italic: true }],
      'hello world',
      'heLllo world',
    )

    expect(next).toEqual([{ start: 0, end: 6, italic: true }])
    expect(getTextMarkSegments('hello', next)).toEqual([
      { text: 'hello', marks: { italic: true } },
    ])
  })

  it('invalidates the content hash when formatting changes', () => {
    const base: ContentBlock = { type: 'text', text: 'Point', position: 0, listType: null, indent: 0 }
    expect(computeContentHash([base])).not.toBe(computeContentHash([{ ...base, listType: 'bullet' }]))
    expect(computeContentHash([base])).not.toBe(computeContentHash([{ ...base, indent: 1 }]))
  })
})
