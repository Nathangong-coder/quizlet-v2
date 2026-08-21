import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Regression guard for the /forgot outage (2026-08-20): a file carrying the
 * file-level 'use server' directive that also exports a plain (non-async)
 * binding compiles fine under tsc and vitest — neither enforces the Server
 * Actions convention — and only fails at request time, inside Turbopack, the
 * first time the route renders. See src/actions/auth-reset.ts and
 * src/actions/auth-verify.ts for the fix (barrel + `.server.ts` split).
 *
 * This statically scans every file under src/ that opens with a file-level
 * 'use server' directive and asserts every export from it is an async
 * function (or a type-only export, which is erased before the bundler ever
 * sees it and is never a violation).
 */

interface Violation {
  file: string
  name: string
}

/** True only when the FIRST statement of the file is the 'use server' directive. */
function hasFileLevelUseServer(sourceFile: ts.SourceFile): boolean {
  const [first] = sourceFile.statements
  if (!first || !ts.isExpressionStatement(first)) return false
  const expr = first.expression
  return ts.isStringLiteral(expr) && expr.text === 'use server'
}

function isAsyncFunctionLike(node: ts.Node | undefined): boolean {
  if (!node) return false
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  ) {
    return true
  }
  return false
}

function findLocalDeclarationAsyncness(
  sourceFile: ts.SourceFile,
  name: string,
): boolean | undefined {
  let found: boolean | undefined
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      found = isAsyncFunctionLike(stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          found = isAsyncFunctionLike(decl.initializer)
        }
      }
    }
  }
  return found
}

function checkFile(filePath: string, text: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (!hasFileLevelUseServer(sourceFile)) return []

  const violations: Violation[] = []

  for (const stmt of sourceFile.statements) {
    const isExported = (node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }) =>
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

    // export function foo(...) / export default function foo(...)
    if (ts.isFunctionDeclaration(stmt) && isExported(stmt)) {
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
      const name = isDefault ? 'default' : stmt.name?.text ?? '<anonymous>'
      if (!isAsyncFunctionLike(stmt)) violations.push({ file: filePath, name })
      continue
    }

    // export class Foo (never valid — a class isn't async)
    if (ts.isClassDeclaration(stmt) && isExported(stmt)) {
      violations.push({ file: filePath, name: stmt.name?.text ?? '<anonymous class>' })
      continue
    }

    // export interface / export type — type-only, erased before bundling. Never flagged.
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      continue
    }

    // export const/let/var foo = ...
    if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const name = ts.isIdentifier(decl.name) ? decl.name.text : '<destructured>'
        if (!isAsyncFunctionLike(decl.initializer)) {
          violations.push({ file: filePath, name })
        }
      }
      continue
    }

    // export default <expr> (non-function-declaration form, e.g. `export default foo`)
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (!isAsyncFunctionLike(stmt.expression)) {
        violations.push({ file: filePath, name: 'default' })
      }
      continue
    }

    // export { a, b as c } [from './somewhere']
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const fromExternalModule = stmt.moduleSpecifier !== undefined
      for (const spec of stmt.exportClause.elements) {
        const exportedName = spec.name.text
        if (spec.isTypeOnly) continue
        if (fromExternalModule) {
          // Re-exporting from another module: this file's directive governs
          // this file's own bundle, but we cannot resolve the binding's
          // async-ness without loading that module too. Cross-file barrels
          // (like auth-verify.ts) never carry the directive themselves, so
          // this branch is defensive rather than load-bearing today.
          continue
        }
        const localName = spec.propertyName?.text ?? exportedName
        const asyncness = findLocalDeclarationAsyncness(sourceFile, localName)
        if (asyncness !== true) {
          violations.push({ file: filePath, name: exportedName })
        }
      }
    }
  }

  return violations
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('use server files export only async functions', () => {
  it('flags no non-async exports from any file-level "use server" module', () => {
    const root = path.resolve(__dirname, '..', '..', 'src')
    const files = walk(root, [])

    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      // Cheap pre-filter before paying for a full parse.
      if (!text.includes('use server')) continue
      const fileViolations = checkFile(file, text)
      for (const v of fileViolations) {
        violations.push(`${path.relative(root, v.file)}: export "${v.name}" is not async`)
      }
    }

    expect(violations).toEqual([])
  })
})
