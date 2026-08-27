import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const sets = read('src/actions/sets.ts')
const klp = read('src/actions/klp.ts')
const editor = read('src/components/sets/KlpEditor.tsx')

describe('KLT trigger wiring', () => {
  it('schedules summarization at every site that schedules extraction', () => {
    const extractions = (sets.match(/await extractKlpsForCards\(/g) ?? []).length
    const summarizations = (sets.match(/await summarizeKltsForCards\(/g) ?? []).length
    expect(extractions).toBeGreaterThan(0)
    expect(summarizations).toBe(extractions)
  })

  it('places new concepts after summarizing them, at every save site', () => {
    // Without this the tree freezes: a concept gets created but never parented,
    // so it reports mastery as an isolated node and never rolls up. Placement
    // must come THIRD — it can only place concepts summarization has created.
    const summarizations = (sets.match(/await summarizeKltsForCards\(/g) ?? []).length
    const placements = (sets.match(/await placeUnparentedConcepts\(/g) ?? []).length
    expect(placements).toBe(summarizations)
    for (const block of sets.split('after(async () => {').slice(1)) {
      const body = block.split('})')[0]
      if (!body.includes('placeUnparentedConcepts')) continue
      expect(body.indexOf('summarizeKltsForCards')).toBeLessThan(
        body.indexOf('placeUnparentedConcepts'),
      )
    }
  })

  it('chains summarization AFTER extraction, never in parallel', () => {
    // Racing them would summarize KLPs that do not exist yet. Every
    // summarize call must be preceded by an awaited extract in the same block.
    for (const block of sets.split('after(async () => {').slice(1)) {
      const body = block.split('})')[0]
      if (!body.includes('summarizeKltsForCards')) continue
      expect(body.indexOf('extractKlpsForCards')).toBeLessThan(
        body.indexOf('summarizeKltsForCards'),
      )
    }
  })

  it('resets kltStatus whenever a new KLP version is written', () => {
    // A new version has new klpIds, so the old labels and topics describe
    // propositions the card no longer teaches.
    const body = klp.split('async function writeKlpVersion')[1].split('\n}')[0]
    expect(body).toMatch(/kltStatus: 'pending'/)
  })

  it('marks kltStatus pending up front on an edit, as klpStatus already is', () => {
    expect(sets).toMatch(/klpStatus: 'pending' satisfies CardKlpStatus,\s*\n\s*kltStatus: 'pending'/)
  })

  it('keeps the narrowed append-only rule documented on writeKlpVersion', () => {
    expect(klp).toContain('ONE EXCEPTION')
    expect(klp).toMatch(/`label` is a derived\n \* display annotation/)
  })

  it('returns the label and topic status to the editor', () => {
    expect(klp).toMatch(/label: true/)
    expect(klp).toMatch(/kltStatus: toCardKlpStatus\(card\.kltStatus\)/)
  })

  it('offers a topic retry that is separate from the KLP retry', () => {
    expect(editor).toContain('retryKltSummarization')
    expect(editor).toContain('retryKlpExtraction')
    expect(editor).toMatch(/kltStatus === 'failed'/)
  })
})
