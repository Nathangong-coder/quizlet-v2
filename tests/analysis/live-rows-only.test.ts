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

const ROOT = join(__dirname, '../..')
const SCANNED_DIRS = [
  'src/lib/metrics', 'src/lib/analysis', 'src/lib/staff', 'src/lib/memory', 'src/lib/klp', 'src/lib/diagnostic',
  'src/actions',
  // Operator scripts count evidence too — an integrity check that counts every
  // generation reports a regraded posterior as over-claiming its observations.
  'scripts',
]

const DELEGATES = [
  'answerKlpResult',
  'answerErrorTag',
  'answerRelationResult',
  'answerFormResult',
  'answerUnwarrantedClaim',
]
const READ_METHODS = ['findMany', 'findFirst', 'findUnique', 'groupBy', 'aggregate', 'count']
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

/** `block` with every nested `{...}` below its own top level blanked out. */
function topLevelOnly(block: string): string {
  let depth = 0
  let out = ''
  for (const ch of block) {
    if (ch === '{') {
      depth += 1
      out += depth === 1 ? ch : ' '
    } else if (ch === '}') {
      out += depth === 1 ? ch : ' '
      depth -= 1
    } else {
      out += depth <= 1 ? ch : ' '
    }
  }
  return out
}

/**
 * Does `block` (a Prisma argument or nested-relation block) filter the ROW
 * to the live generation? The filter must sit at the top level of the
 * block's own `where:` (or `some:`/`every:`/`none:` predicate) — a nested
 * `klp: { supersededAt: null }` is a filter on the KEY POINT, not the row,
 * and must not satisfy this.
 */
function filtersLiveRows(block: string): boolean {
  const re = /\b(where|some|every|none):\s*\{/g
  for (const m of block.matchAll(re)) {
    const pred = balancedBlock(block, m.index + m[0].length - 1)
    if (/supersededAt:\s*null/.test(topLevelOnly(pred))) return true
  }
  return false
}

function delegateReads(file: string, src: string): Site[] {
  const sites: Site[] = []
  const re = new RegExp(`\\.(${DELEGATES.join('|')})\\.(${READ_METHODS.join('|')})\\(`, 'g')
  for (const m of src.matchAll(re)) {
    const openAt = m.index + m[0].length - 1
    const block = balancedBlock(src, openAt)
    if (!filtersLiveRows(block)) {
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
    if (!filtersLiveRows(block)) {
      sites.push({ file, line: src.slice(0, m.index).split('\n').length, text: m[0] })
    }
  }
  return sites
}

describe('readers of analysis rows see the live generation only', () => {
  const files = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))

  it('scans a non-trivial corpus, scripts included', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => relative(ROOT, f).startsWith('scripts'))).toBe(true)
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
    // `count` is a read: an integrity check that counts every generation is
    // exactly the over-claiming this filter prevents.
    expect(all).toMatch(/\.answerKlpResult\.count\(/)
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

  it('treats count as a read', () => {
    const bad = `const n = await prisma.answerKlpResult.count({ where: { klpId: 'k' } })`
    expect(delegateReads('x.ts', bad)).toHaveLength(1)
    const bare = `const n = await prisma.answerErrorTag.count()`
    expect(delegateReads('x.ts', bare)).toHaveLength(1)
    const good = `const n = await prisma.answerKlpResult.count({ where: { klpId: 'k', supersededAt: null } })`
    expect(delegateReads('x.ts', good)).toHaveLength(0)
  })

  it('requires the filter on the ROW, not on a nested relation', () => {
    // `klp: { supersededAt: null }` filters the KEY POINT (its own
    // `supersededAt` is the KLP-version test). It says nothing about which
    // generation of RESULT rows is read, and must not pass.
    const nestedOnly = `const rows = await prisma.answerKlpResult.findMany({ where: { quizAnswer: { userId }, klp: { supersededAt: null } } })`
    expect(delegateReads('x.ts', nestedOnly)).toHaveLength(1)
    const nestedRelationOnly = `select: { klpResults: { where: { klp: { supersededAt: null } }, select: { klpId: true } } }`
    expect(nestedReads('x.ts', nestedRelationOnly)).toHaveLength(1)
    // And the regrade-run shape — the ROW filter beside a KLP filter — passes.
    const both = `where: { cardId, klpResults: { some: { supersededAt: null, klp: { supersededAt: { not: null } } } } }`
    expect(nestedReads('x.ts', both)).toHaveLength(0)
    const rowAndKlp = `await prisma.answerKlpResult.findMany({ where: { supersededAt: null, klp: { supersededAt: { not: null } } } })`
    expect(delegateReads('x.ts', rowAndKlp)).toHaveLength(0)
  })
})
