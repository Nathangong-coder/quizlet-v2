import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Regression guard for the 2026-08-26 review finding #1: `applyPaths`
 * (`src/actions/klt-seed.ts`) and `loadSetTree` (`src/actions/klt-tree.ts`)
 * were `export`ed from `'use server'` modules with no `requireSetKltAccess`
 * (or any) gate of their own. In Next.js EVERY export of a file-level
 * `'use server'` module is a callable server-action RPC endpoint — not just
 * the ones another module happens to import — so both were directly
 * reachable by anyone with the action id: `loadSetTree` leaked another
 * owner's whole concept tree, and `applyPaths` was a structural WRITE into
 * an arbitrary `setId` with no session or ownership check at all.
 *
 * `tests/actions/use-server-exports.test.ts` does not catch this shape — it
 * only checks that every export is `async`, which both violating functions
 * were. This guard checks the thing that actually matters: every ASYNC
 * FUNCTION exported from one of these four action modules either calls a
 * known access gate in its own body, or is on the short, individually
 * justified allowlist below for a function that gates access a different,
 * verified way. A TYPE-ONLY export (`interface`/`type`) is never flagged —
 * it is erased before the bundler ever sees it and cannot be an RPC endpoint.
 *
 * A named RE-EXPORT (`export { x } from '...'` or `export { x }`) is ALWAYS
 * a violation, regardless of what `x` does — that is the exact shape of the
 * original bug (a helper imported for internal reuse and re-exported
 * alongside it), and this file cannot see whether the re-exported binding is
 * gated without reading a second file. The fix for both `applyPaths` and
 * `loadSetTree` was to stop them being reachable this way at all: they now
 * live in `src/lib/klt/structure.ts`, a plain library module with no
 * `'use server'` directive, imported (never re-exported) by every caller.
 */

const GATE_PATTERNS = [
  /requireSetKltAccess\s*\(/,
  /isCallerKltAdmin\s*\(\s*\)/,
  /requireAdmin\s*\(/,
]

// `requireStaff` is deliberately NOT in GATE_PATTERNS, for the same reason
// `requireSetKltView` isn't: it is a WEAKER gate than everything above (staff
// is not admin), so admitting it globally would let a write action silently
// downgrade its own check and still pass this guard.
//
// It counts as a gate ONLY inside `staff.ts`, mirroring READ_GATE_ALLOWLIST's
// approach of scoping a weaker-but-real gate to exactly the file(s) it is
// verified safe for. Unlike READ_GATE_ALLOWLIST it is not keyed by function
// name: `staff.ts` exists to be the staff-only surface, so every export in it
// (including ones added by later tasks) is expected to gate with `requireStaff`
// specifically, and the point of this guard is still enforced — a `staff.ts`
// export that calls no gate at all still fails below.
const STAFF_GATE_PATTERN = /requireStaff\s*\(/
const STAFF_GATE_FILES = new Set(['staff.ts'])

/**
 * `requireSetKltView` is a REAL gate, but a weaker one: it admits anyone who
 * may read the set, including a stranger holding the link to a link-shared
 * one. Adding it to `GATE_PATTERNS` would therefore have quietly widened what
 * this guard accepts — a write action switched to the read gate to "fix" a
 * 404 would pass silently, which is precisely the class of bug this file
 * exists to catch.
 *
 * So it counts as a gate ONLY for the exports named below, each of which is a
 * pure read. Anything else reaching for it fails here by name.
 */
const READ_GATE_PATTERN = /requireSetKltView\s*\(/

const READ_GATE_ALLOWLIST: Record<string, string[]> = {
  // Reads one set's structure, and what is filed under one of its concepts.
  // Neither writes anything; both are what a shared-set viewer sees.
  'klt-tree.ts': ['listConceptTree', 'listConceptCards'],
}

/**
 * Functions that gate access WITHOUT calling one of the patterns above,
 * individually verified here rather than trusted blind. Each entry names
 * exactly why its own inline check is a real gate.
 */
const EXPLICIT_GATE_ALLOWLIST: Record<string, string[]> = {
  // Resolves the session itself (`auth()` -> `session?.user?.id`) and scopes
  // its one read to `{ id: cardId, set: { userId } }` — ownership embedded in
  // the query, the same posture `requireSetKltAccess` uses, just inlined
  // because this action's target is a card, not a set.
  'klt.ts': ['retryKltSummarization'],
}

const FILES = ['klt-seed.ts', 'klt-tree.ts', 'klt-presets.ts', 'klt.ts', 'staff.ts', 'staff-roles.ts']

interface Violation {
  file: string
  name: string
  reason: string
}

function checkFile(fileName: string, text: string): Violation[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: Violation[] = []
  const allowlisted = new Set(EXPLICIT_GATE_ALLOWLIST[fileName] ?? [])
  const readGated = new Set(READ_GATE_ALLOWLIST[fileName] ?? [])

  const isGated = (name: string, body: string) =>
    GATE_PATTERNS.some((p) => p.test(body)) ||
    (readGated.has(name) && READ_GATE_PATTERN.test(body)) ||
    (STAFF_GATE_FILES.has(fileName) && STAFF_GATE_PATTERN.test(body))

  const isExported = (node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }) =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

  for (const stmt of sourceFile.statements) {
    // Type-only exports are erased before bundling — never an RPC endpoint.
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue

    // A named re-export is always a violation here — see the file doc
    // comment. This is what the original bug would have looked like if
    // `klt-presets.ts` had re-exported `applyPaths`/`loadSetTree` instead of
    // importing them for its own internal use.
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        if (spec.isTypeOnly) continue
        violations.push({
          file: fileName,
          name: spec.name.text,
          reason: 're-exported by name from a \'use server\' module — cannot verify gating from this file',
        })
      }
      continue
    }

    if (ts.isFunctionDeclaration(stmt) && isExported(stmt) && stmt.name) {
      const name = stmt.name.text
      const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      if (!isAsync) continue // caught by use-server-exports.test.ts, not this guard

      if (allowlisted.has(name)) continue

      const body = stmt.body?.getText(sourceFile) ?? ''
      if (!isGated(name, body)) {
        violations.push({
          file: fileName,
          name,
          reason: 'calls no known access gate (requireSetKltAccess / isCallerKltAdmin / requireAdmin, or requireSetKltView on a read-allowlisted export) and is not on the explicit allowlist',
        })
      }
      continue
    }

    // export const/let/var foo = async (...) => {...} — none of these files
    // use this form today, but a future one that does must still be checked.
    if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const name = ts.isIdentifier(decl.name) ? decl.name.text : '<destructured>'
        if (allowlisted.has(name)) continue
        const init = decl.initializer
        const isAsyncFn =
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
        if (!isAsyncFn) continue
        const body = init.body.getText(sourceFile)
        if (!isGated(name, body)) {
          violations.push({
            file: fileName,
            name,
            reason: 'calls no known access gate and is not on the explicit allowlist',
          })
        }
      }
    }
  }

  return violations
}

describe('every export of a KLT `use server` action module is gated, type-only, or explicitly justified', () => {
  it('flags no ungated, non-allowlisted async export from klt-seed.ts, klt-tree.ts, klt-presets.ts, klt.ts, or staff.ts', () => {
    const violations: string[] = []
    for (const file of FILES) {
      const fullPath = path.resolve(__dirname, '..', '..', 'src', 'actions', file)
      const text = readFileSync(fullPath, 'utf8')
      for (const v of checkFile(file, text)) {
        violations.push(`${v.file}: export "${v.name}" — ${v.reason}`)
      }
    }
    expect(violations).toEqual([])
  })
})
