import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * Spec 5 Phase A §6: a regrade writes a NEW generation of analysis rows and
 * marks the old one `supersededAt` — it never deletes. So every reader that
 * feeds a metric, a staff view, a results page or the erase planner must see
 * LIVE rows only, or a regraded answer counts twice: once under the old
 * grader and once under the new.
 *
 * A source scan, because the filter is one `where` clause per read and a
 * new read site that forgets it looks exactly like one that never needed it.
 * Two shapes are scanned:
 *
 *   1. A delegate read — `prisma.answerKlpResult.findMany({ ... })`,
 *      `tx.answerErrorTag.groupBy({ ... })` and so on — whose argument block
 *      must contain `supersededAt: null`.
 *   2. A nested relation select on a parent read — `klpResults: { select:
 *      ... }`, `errorTags: { include: ... }` — whose block must carry
 *      `where: { supersededAt: null }` (or a `some:` predicate that does).
 *
 * `createMany`, `updateMany`, `deleteMany` and `count` are writers or are
 * not generation-scoped reads and are not scanned.
 */

const ROOT = join(__dirname, '../../src')
const SCANNED_DIRS = ['lib/metrics', 'lib/analysis', 'lib/staff', 'lib/memory', 'lib/klp', 'lib/diagnostic', 'actions']

const DELEGATES = [
  'answerKlpResult',
  'answerErrorTag',
  'answerRelationResult',
  'answerFormResult',
  'answerUnwarrantedClaim',
]
const READ_METHODS = ['findMany', 'findFirst', 'findUnique', 'groupBy', 'aggregate']
const NESTED_KEYS = ['klpResults', 'errorTags', 'relationResults', 'formResults', 'unwarranted']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full)
  }
  return out
}

/** The text of the balanced `{...}` or `(...)` block that opens at `openAt`. */
function balancedBlock(src: string, openAt: number): string {
  const open = src[openAt]
  const close = open === '(' ? ')' : '}'
  let depth = 0
  for (let i = openAt; i < src.length; i++) {
    const ch = src[i]
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return src.slice(openAt, i + 1)
    }
  }
  return src.slice(openAt)
}

interface Site {
  file: string
  line: number
  text: string
}

function delegateReads(file: string, src: string): Site[] {
  const sites: Site[] = []
  const re = new RegExp(`\\.(${DELEGATES.join('|')})\\.(${READ_METHODS.join('|')})\\(`, 'g')
  for (const m of src.matchAll(re)) {
    const openAt = m.index + m[0].length - 1
    const block = balancedBlock(src, openAt)
    if (!/supersededAt:\s*null/.test(block)) {
      sites.push({ file, line: src.slice(0, m.index).split('\n').length, text: m[0] })
    }
  }
  return sites
}

function nestedReads(file: string, src: string): Site[] {
  const sites: Site[] = []
  const re = new RegExp(`\\b(${NESTED_KEYS.join('|')}):\\s*\\{`, 'g')
  for (const m of src.matchAll(re)) {
    const openAt = m.index + m[0].length - 1
    const block = balancedBlock(src, openAt)
    // A Prisma nested read carries `select:` / `include:` / `some:`. A type
    // declaration or an object literal of drafts carries neither and is not
    // a read.
    if (!/\b(select|include|some|every|none):/.test(block)) continue
    if (!/supersededAt:\s*null/.test(block)) {
      sites.push({ file, line: src.slice(0, m.index).split('\n').length, text: m[0] })
    }
  }
  return sites
}

describe('readers of analysis rows see the live generation only', () => {
  const files = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))

  it('scans a non-trivial corpus', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('every delegate read of an analysis table filters supersededAt: null', () => {
    const missing = files.flatMap((f) => delegateReads(relative(ROOT, f), readFileSync(f, 'utf-8')))
    expect(missing, missing.map((s) => `${s.file}:${s.line} ${s.text}`).join('\n')).toEqual([])
  })

  it('every nested relation read of an analysis table filters supersededAt: null', () => {
    const missing = files.flatMap((f) => nestedReads(relative(ROOT, f), readFileSync(f, 'utf-8')))
    expect(missing, missing.map((s) => `${s.file}:${s.line} ${s.text}`).join('\n')).toEqual([])
  })

  it('the scan itself finds the reads it guards (a guard that matches nothing cannot fail)', () => {
    const all = files.map((f) => readFileSync(f, 'utf-8')).join('\n')
    const delegateHits = [...all.matchAll(new RegExp(`\\.(${DELEGATES.join('|')})\\.(${READ_METHODS.join('|')})\\(`, 'g'))]
    const nestedHits = [...all.matchAll(new RegExp(`\\b(${NESTED_KEYS.join('|')}):\\s*\\{\\s*(select|include|where)`, 'g'))]
    expect(delegateHits.length).toBeGreaterThanOrEqual(5)
    expect(nestedHits.length).toBeGreaterThanOrEqual(3)
  })

  it('flags a read that forgets the filter', () => {
    const bad = `const rows = await prisma.answerKlpResult.findMany({ where: { klpId: 'k' } })`
    expect(delegateReads('x.ts', bad)).toHaveLength(1)
    const good = `const rows = await prisma.answerKlpResult.findMany({ where: { klpId: 'k', supersededAt: null } })`
    expect(delegateReads('x.ts', good)).toHaveLength(0)
    const nestedBad = `select: { klpResults: { select: { klpId: true } } }`
    expect(nestedReads('x.ts', nestedBad)).toHaveLength(1)
    const nestedGood = `select: { klpResults: { where: { supersededAt: null }, select: { klpId: true } } }`
    expect(nestedReads('x.ts', nestedGood)).toHaveLength(0)
    const notARead = `errorTags: {\n  dimension: Dimension\n  type: string\n}[]`
    expect(nestedReads('x.ts', notARead)).toHaveLength(0)
  })
})
