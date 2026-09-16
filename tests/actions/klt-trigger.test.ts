import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Newlines are normalised: core.autocrlf=true means the working tree carries
// CRLF on Windows while the repo stores LF, so a regex written against a
// line break would pass or fail depending on who checked the file out --
// a property of the clone, not of the source.
const read = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const sets = read('src/actions/sets.ts')
const klp = read('src/actions/klp.ts')
const klpWrite = read('src/lib/cards/klp-write.ts')
const editor = read('src/components/sets/KlpEditor.tsx')

describe('KLT trigger wiring', () => {
  it('no longer summarises or places at a save site — the topic layer is built by the owner build step (2026-09-16)', () => {
    // The legacy summariser wrote AI-summarised nodes straight into the
    // owner's tree; the tree is now the minting loop's and the set-level
    // rebuild's, run from `src/lib/klp/build-set.ts`. A save still schedules
    // the legacy extraction so a quiz has key points minutes after an edit,
    // and sends the owner back with `?build=1` so the real build starts.
    const extractions = (sets.match(/await extractKlpsForCards\(/g) ?? []).length
    const summarizations = (sets.match(/await summarizeKltsForCards\(/g) ?? []).length
    expect(extractions).toBeGreaterThan(0)
    expect(summarizations).toBe(0)
    expect(sets).toContain('build: stale.length > 0')
    expect(read('src/components/sets/SetForm.tsx')).toContain("?build=1")
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
    const body = klpWrite.split('export async function writeKlpVersion')[1].split('\n}')[0]
    expect(body).toMatch(/kltStatus: 'pending'/)
  })

  it('marks kltStatus pending up front on an edit, as klpStatus already is', () => {
    expect(sets).toMatch(/klpStatus: 'pending' satisfies CardKlpStatus,\s*\n\s*kltStatus: 'pending'/)
  })

  it('keeps the narrowed append-only rule documented on writeKlpVersion', () => {
    expect(klpWrite).toContain('ONE EXCEPTION')
    expect(klpWrite).toMatch(/`label` is a derived\n \* display annotation/)
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
