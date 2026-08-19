import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOT = process.cwd()

/**
 * Modules that must never reach the edge bundle.
 *
 * bcrypt and friends because the edge runtime has no native modules; Prisma
 * because it does not run there either; `@/auth` because importing it from the
 * edge half would drag the whole Node graph across in one line.
 */
const FORBIDDEN = [
  'bcryptjs',
  'bcrypt',
  'argon2',
  '@node-rs/argon2',
  '@prisma/client',
  '@/lib/db',
  '@/auth',
  '@/lib/auth/password',
  '@/lib/auth/credentials',
  '@/lib/auth/session',
]

/** The two entry points that are bundled for the edge runtime. */
const EDGE_ENTRY_POINTS = ['src/auth.config.ts', 'src/middleware.ts']

/** Split out from `readImports` so the pattern is testable without the disk. */
function parseImports(source: string): string[] {
  const specifiers: string[] = []
  // `import\s*\(` is NOT redundant with `import\s+`: the latter requires
  // whitespace, so a DYNAMIC `await import('@/lib/db')` matched nothing at all.
  // That is the idiomatic way someone tries to "fix" a bundling error in the
  // edge half — i.e. the guard would have stayed green through the exact
  // mistake it exists to catch.
  const pattern = /(?:from\s+|import\s*\(|import\s+|require\()\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1])
  return specifiers
}

function readImports(file: string): string[] {
  return parseImports(readFileSync(file, 'utf8'))
}

/**
 * A specifier is forbidden if it IS a forbidden module or lives inside one.
 *
 * Exact matching let `@prisma/client/edge`, `bcryptjs/dist/bcrypt` and any
 * future `@/lib/auth/tokens` through — subpaths of a banned module are the
 * same module.
 */
function isForbidden(specifier: string): boolean {
  return FORBIDDEN.some((f) => specifier === f || specifier.startsWith(`${f}/`))
}

/** Resolve a specifier to a file in this repo, or null if it is a package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return null

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Every specifier reachable from `entry`, following local files transitively. */
function transitiveImports(entry: string): { specifier: string; via: string }[] {
  const seen = new Set<string>()
  const found: { specifier: string; via: string }[] = []
  const queue = [join(ROOT, entry)]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const specifier of readImports(file)) {
      found.push({ specifier, via: file })
      const local = resolveLocal(specifier, file)
      if (local) queue.push(local)
    }
  }
  return found
}

describe('the edge bundle', () => {
  // Transitive, not a text search of the two files. A one-line re-export is
  // all it takes to pull bcrypt into middleware, and the failure is at request
  // time in production: `tsc` and every other test pass straight over it.
  // Same class of invisible failure as trap 8's $queryRaw.
  it.each(EDGE_ENTRY_POINTS)('%s reaches no Node-only module, at any depth', (entry) => {
    const reached = transitiveImports(entry)
    const violations = reached.filter((r) => isForbidden(r.specifier))
    expect(violations).toEqual([])
  })

  it('actually walks past the entry point (the guard can fail)', () => {
    // Without this, a broken resolver would make the assertion above vacuous:
    // it would scan one file, find nothing, and pass forever.
    const reached = transitiveImports('src/middleware.ts')
    expect(reached.map((r) => r.specifier)).toContain('@/auth.config')
    expect(reached.some((r) => r.via.endsWith('auth.config.ts'))).toBe(true)
  })

  // The two tests below cover the scanner itself. Both close a hole the guard
  // had while looking green: a scanner that misses a specifier reports no
  // violations, which is indistinguishable from a clean graph.
  it('sees a DYNAMIC import, not only a static one', () => {
    // A lazy `await import(...)` is how someone "fixes" a bundling error in
    // the edge half — and it bundles the module just the same.
    expect(parseImports(`async function f() { const db = await import('@/lib/db') }`)).toEqual([
      '@/lib/db',
    ])
    expect(parseImports(`const { prisma } = require("@/lib/db")`)).toEqual(['@/lib/db'])
    expect(parseImports(`import 'server-only'`)).toEqual(['server-only'])
    expect(parseImports(`import { a } from "./x"`)).toEqual(['./x'])
  })

  it('treats a SUBPATH of a forbidden module as forbidden', () => {
    expect(isForbidden('@prisma/client/edge')).toBe(true)
    expect(isForbidden('bcryptjs/dist/bcrypt')).toBe(true)
    expect(isForbidden('@/lib/auth/password')).toBe(true)
    // Prefix matching must not over-reach: a sibling that merely shares a
    // leading string is a different module.
    expect(isForbidden('@/lib/auth/identifier')).toBe(false)
    expect(isForbidden('@/lib/dbutils')).toBe(false)
    expect(isForbidden('next-auth')).toBe(false)
  })

  it('the Credentials provider is wired in src/auth.ts, not auth.config.ts', () => {
    const nodeHalf = readFileSync(join(ROOT, 'src/auth.ts'), 'utf8')
    const edgeHalf = readFileSync(join(ROOT, 'src/auth.config.ts'), 'utf8')
    expect(nodeHalf).toContain('next-auth/providers/credentials')
    expect(edgeHalf).not.toMatch(/from\s+['"]next-auth\/providers\/credentials['"]/)
  })
})
