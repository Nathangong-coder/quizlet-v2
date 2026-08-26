import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

/**
 * Task 6a: `Klt.parentKltId`/`Klt.depth`/`Klt.ancestorIds` (plus the
 * `KltTree` self-relation) are DEPRECATED but still present in the schema —
 * Task 6b drops them once a verified rebuild proves `SetKltNode` fully
 * replaced them. Until that drop lands, nothing under `src/` or `scripts/`
 * may read those columns off the `Klt` model: a straggling reader would
 * silently read a value that stopped being written back in Task 2, which is
 * a worse failure than a missing feature because it looks like it works.
 *
 * This is the guard the plan calls for as "no file reads klt.parentKltId,
 * klt.depth, klt.ancestorIds, or selects those fields off the Klt model" —
 * turning that straggler into a build failure rather than a silent stale
 * read. It is deliberately a static scan of source text, not a type-level
 * check: the whole point is to catch a `prisma.klt.findMany({ select: {...
 * parentKltId: true } })` before it ever runs, and a scan needs no database.
 *
 * `SetKltNode` declares the SAME field names (`parentKltId`, `depth`,
 * `ancestorIds`) on purpose — see the schema and `src/lib/klt/tree.ts` — so
 * this cannot be a bare grep for the field names; it must scope to calls
 * against the `klt` (or `Klt`) model specifically. It targets:
 *   - `prisma.klt.<method>(...)` / `tx.klt.<method>(...)` calls whose
 *     argument object mentions any deprecated field (covers `select`,
 *     `include`, `data`, `where`, orderBy — anywhere in the call, which is
 *     intentionally broader than just `select`, since an `orderBy: {
 *     depth: 'asc' }` reads the column just as much as a `select` does);
 *   - a direct property access chain like `row.klt.parentKltId` / a
 *     destructure off a variable named `klt`.
 */

const ROOT = process.cwd()
const SCAN_DIRS = ['src', 'scripts']
const EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIP_DIR_NAMES = new Set(['node_modules', '.next', 'cursor-agents'])

const DEPRECATED_FIELDS = ['parentKltId', 'depth', 'ancestorIds'] as const

interface Violation {
  file: string
  line: number
  field: string
  snippet: string
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...listFiles(full))
    } else if (EXTENSIONS.has(extname(full))) {
      out.push(full)
    }
  }
  return out
}

/** 1-based line number of a character offset. */
function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/**
 * The substring of `source` starting at the `(` found at-or-after
 * `fromIndex`, up to (and including) its matching close paren. Returns null
 * if the parens never balance (shouldn't happen in valid TS, but a scanner
 * must not throw on a scan it merely misjudges).
 */
function balancedCallArgs(source: string, fromIndex: number): string | null {
  const openIndex = source.indexOf('(', fromIndex)
  if (openIndex === -1) return null
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return null
}

/**
 * Every deprecated-column read this file's SOURCE TEXT contains, scoped to
 * calls against the `klt` model (`prisma.klt.*` / `tx.klt.*`) and direct
 * `.klt.<field>` property access — never a bare field-name match, which
 * would false-positive on every legitimate `SetKltNode` read in the same
 * files (they share field names by design).
 */
function findViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = []

  // `prisma.klt.<method>(...)` / `tx.klt.<method>(...)` — any Prisma client
  // variable name ending in a plausible identifier, dotted into `.klt.`,
  // dotted into a method call. Then scan the BALANCED call arguments (not
  // just up to the next paren) for a deprecated field name as a whole word.
  const callPattern = /\b\w+\.klt\.\w+\s*\(/g
  let match: RegExpExecArray | null
  while ((match = callPattern.exec(source)) !== null) {
    const args = balancedCallArgs(source, match.index)
    if (args === null) continue
    for (const field of DEPRECATED_FIELDS) {
      const fieldPattern = new RegExp(`\\b${field}\\b`)
      if (fieldPattern.test(args)) {
        violations.push({
          file,
          line: lineAt(source, match.index),
          field,
          snippet: match[0],
        })
      }
    }
  }

  // Direct property access: `something.klt.parentKltId` / `.klt.depth` /
  // `.klt.ancestorIds` — e.g. a joined row read off a query built elsewhere.
  for (const field of DEPRECATED_FIELDS) {
    const accessPattern = new RegExp(`\\.klt\\.${field}\\b`, 'g')
    let accessMatch: RegExpExecArray | null
    while ((accessMatch = accessPattern.exec(source)) !== null) {
      violations.push({
        file,
        line: lineAt(source, accessMatch.index),
        field,
        snippet: accessMatch[0],
      })
    }
  }

  return violations
}

describe('deprecated Klt structure columns have no readers', () => {
  it('finds no read of klt.parentKltId / klt.depth / klt.ancestorIds under src/ or scripts/', () => {
    const files = SCAN_DIRS.flatMap((dir) => listFiles(join(ROOT, dir)))
    const violations = files.flatMap((file) => findViolations(file, readFileSync(file, 'utf8')))

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line} reads deprecated field '${v.field}' (${v.snippet})`)
        .join('\n')
      throw new Error(
        `${violations.length} deprecated-column read(s) found — structure moved to SetKltNode ` +
          `in Task 2; these must migrate before Task 6 drops the columns:\n${detail}`,
      )
    }

    expect(violations).toEqual([])
  })

  it('actually scans real files (the guard can fail)', () => {
    // Without this, a broken path/list-files bug would make the assertion
    // above vacuous: it would scan zero files, find nothing, and pass
    // forever. Assert the scan reaches known, real KLT source files.
    const files = SCAN_DIRS.flatMap((dir) => listFiles(join(ROOT, dir)))
    expect(files.some((f) => f.endsWith(join('scripts', 'backfill-klts.ts')))).toBe(true)
    expect(files.some((f) => f.endsWith(join('src', 'lib', 'klt', 'health.ts')))).toBe(true)
  })

  it('does not false-positive on legitimate SetKltNode reads sharing the same field names', () => {
    // `SetKltNode` declares parentKltId/depth/ancestorIds on purpose (same
    // shape, different table) — a naive grep for the field names alone would
    // flag every one of these as if it were a Klt read.
    const benign = `
      const rows = await prisma.setKltNode.findMany({
        where: { setId },
        select: { id: true, kltId: true, parentKltId: true, depth: true, ancestorIds: true },
      })
      const node = await tx.setKltNode.upsert({
        create: { setId, kltId: klt.id, parentKltId, depth, ancestorIds },
        select: { id: true, kltId: true, parentKltId: true, depth: true, ancestorIds: true },
      })
    `
    expect(findViolations('fixture.ts', benign)).toEqual([])
  })

  it('catches a select against the klt model directly', () => {
    const bad = `
      const rawRows = await prisma.klt.findMany({
        select: { id: true, name: true, parentKltId: true, depth: true, ancestorIds: true },
      })
    `
    const violations = findViolations('fixture.ts', bad)
    expect(violations.map((v) => v.field).sort()).toEqual(['ancestorIds', 'depth', 'parentKltId'])
  })

  it('catches a direct .klt.<field> property access', () => {
    const bad = `const p = row.klt.parentKltId`
    const violations = findViolations('fixture.ts', bad)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('parentKltId')
  })
})
