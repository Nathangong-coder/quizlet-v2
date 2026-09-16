/**
 * Static import trace: from one or more entry files, follow every `@/`
 * and relative import and print the chain that reaches a target.
 *
 *   npx tsx scripts/trace-imports.ts "src/app/(marketing)/layout.tsx" ui/dialog
 *
 * Answers "why is X in this route's bundle" without a bundler — the
 * analyzer shows WHAT is there, this shows the path.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOT = process.cwd()
const [entryArg, needle] = process.argv.slice(2)
if (!entryArg || !needle) { console.error('usage: trace-imports <entry> <needle>'); process.exit(1) }

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext
    if (existsSync(p) && !p.endsWith('/')) {
      try { if (readFileSync(p)) return p } catch { /* dir */ }
    }
  }
  return null
}

const seen = new Map<string, string[]>() // file -> chain
const queue: [string, string[]][] = [[resolve(ROOT, entryArg), []]]
const hits: string[][] = []
while (queue.length) {
  const [file, chain] = queue.shift()!
  if (seen.has(file)) continue
  seen.set(file, chain)
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g)) {
    const spec = m[1] ?? m[2]
    if (spec.includes(needle)) hits.push([...chain, file, spec])
    const target = resolveImport(file, spec)
    if (target && !seen.has(target)) queue.push([target, [...chain, file]])
  }
}
if (hits.length === 0) console.log(`nothing reachable from ${entryArg} imports "${needle}" (${seen.size} files walked)`)
for (const h of hits) console.log(h.map((p) => p.replace(ROOT, '').replace(/\\/g, '/')).join('\n  -> '), '\n')
