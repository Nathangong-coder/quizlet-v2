import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Secrets stay off the frontend.
 *
 * Anything a `'use client'` module imports ships to the browser. This scans
 * every client module for the three ways a secret could reach it: a direct
 * `process.env` read (only NEXT_PUBLIC_ vars survive, and we have none), an
 * import of a server-only module (the database client, the key cipher, the
 * mail transport, the AI generator), or a `NEXT_PUBLIC_` variable appearing
 * anywhere at all — the day one is added, this test is where it gets
 * justified.
 */
const ROOT = process.cwd()
const SERVER_ONLY = ['@/lib/db', '@/lib/security/api-key', '@/lib/mail/', '@/lib/ai/generate', '@/auth', 'node:crypto']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(join(ROOT, 'src'))
const clientFiles = files.filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')))

describe('client bundle', () => {
  it('has client modules to check', () => {
    expect(clientFiles.length).toBeGreaterThan(20)
  })

  it.each(clientFiles.map((f) => [f.replace(ROOT, '').replace(/\\/g, '/')]))('%s reads no process.env and imports no server-only module', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    expect(src, 'process.env in a client module').not.toMatch(/process\.env/)
    for (const mod of SERVER_ONLY) {
      expect(src, `imports ${mod}`).not.toMatch(new RegExp(`from ['"]${mod.replace(/[/.]/g, '\\$&')}`))
    }
  })

  it('declares no NEXT_PUBLIC_ variables anywhere in src', () => {
    const hits = files.filter((f) => /NEXT_PUBLIC_/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })

  it('.env is gitignored and .env.example holds only placeholders', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(ignore).toMatch(/^\.env(\.local)?$|^\.env\*/m)
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8')
    // A real key is long and has no spaces; a placeholder reads like a word.
    for (const line of example.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (!m) continue
      const value = m[2].trim().replace(/^["']|["']$/g, '')
      expect(value.length < 40 || /^(your|xxx|change|replace|<)/i.test(value) || value.includes('example'), `${m[1]} looks like a real value`).toBe(true)
    }
  })
})
