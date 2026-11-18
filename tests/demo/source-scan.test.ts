import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { isProtectedPath } from '@/lib/auth/gate'

/**
 * Source-level guards on the guest demo's public surface. Behavioural tests
 * (tests/demo/actions.test.ts) cover what each export does today; these pin
 * the shape a future export must keep, because an export added to a
 * 'use server' module is an anonymous, operator-billed endpoint the moment it
 * ships.
 */

const DEMO_ACTIONS = join(process.cwd(), 'src/actions/demo.ts')
const source = readFileSync(DEMO_ACTIONS, 'utf8')
const file = ts.createSourceFile(DEMO_ACTIONS, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function exportedAsyncFunctions(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  for (const stmt of file.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.body) continue
    const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    if (exported && isAsync) out.push({ name: stmt.name?.text ?? '<anonymous>', body: stmt.body.getText(file) })
  }
  return out
}

describe('src/actions/demo.ts', () => {
  const exports = exportedAsyncFunctions()

  it('has the eight demo actions and requestInvite', () => {
    expect(exports.map((e) => e.name).sort()).toEqual(
      ['demoAutocomplete', 'demoExtractPoints', 'demoGauntletOptions', 'demoGauntletRun', 'demoGrade', 'demoGradeGameAnswer', 'demoProbeHotSeat', 'demoStartHotSeat', 'requestInvite'].sort(),
    )
  })

  it.each(exportedAsyncFunctions().map((e) => [e.name, e.body] as const))(
    '%s awaits guestContext() first, before any reservation, run start or AI call',
    (_name, body) => {
      const gate = body.indexOf('guestContext(')
      expect(gate).toBeGreaterThanOrEqual(0)
      // The first await in the body is the gate.
      expect(body.indexOf('await ')).toBe(body.indexOf('await guestContext('))
      for (const call of ['generateJson(', 'reserveCall(', 'startRun(', 'releaseCall(']) {
        const at = body.indexOf(call)
        if (at >= 0) expect(at).toBeGreaterThan(gate)
      }
    },
  )

  it('reserves, starts runs and calls the AI only inside an export (no ungated helper)', () => {
    const inside = (pos: number) =>
      file.statements.some(
        (s) =>
          ts.isFunctionDeclaration(s) &&
          s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
          pos >= s.getStart(file) &&
          pos < s.getEnd(),
      )
    for (const call of ['generateJson(', 'reserveCall(', 'startRun(']) {
      let at = source.indexOf(call)
      while (at >= 0) {
        // Skip the import line and comments.
        const lineStart = source.lastIndexOf('\n', at) + 1
        const line = source.slice(lineStart, source.indexOf('\n', at)).trim()
        if (!line.startsWith('import') && !line.startsWith('//') && !line.startsWith('*')) {
          expect({ call, line, inside: inside(at) }).toEqual({ call, line, inside: true })
        }
        at = source.indexOf(call, at + 1)
      }
    }
  })

  it('writes nothing: no create/upsert/update/delete on any model', () => {
    // Writes may only happen inside @/lib/demo/guard (tickets) or @/lib/demo/waitlist (Task 12).
    const code = source
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    expect(code).not.toMatch(/\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/)
    expect(code).not.toMatch(/\$(executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe|transaction)\b/)
    const imports = file.statements
      .filter(ts.isImportDeclaration)
      .map((d) => (d.moduleSpecifier as ts.StringLiteral).text)
    for (const spec of imports.filter((s) => s.startsWith('@/lib/demo/'))) {
      expect(['@/lib/demo/guard', '@/lib/demo/waitlist', '@/lib/demo/guest-context', '@/lib/demo/demo-set', '@/lib/demo/signed-points', '@/lib/demo/config']).toContain(spec)
    }
  })

  it('every bare generateJson call says it is never persisted', () => {
    const lines = source.split('\n')
    lines.forEach((text, i) => {
      const t = text.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('import')) return
      if (!/\bgenerateJson\s*\(/.test(text)) return
      const window = lines.slice(Math.max(0, i - 8), i).join('\n')
      expect(window).toMatch(/ATTRIBUTION:[\s\S]*never persisted/)
    })
  })
})

describe('/demo stays outside the sign-in gate', () => {
  it('src/middleware.ts has no /demo matcher entry', () => {
    const mw = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')
    const matcher = mw.slice(mw.indexOf('matcher'))
    expect(matcher).not.toMatch(/['"`]\/demo/)
  })

  it("isProtectedPath('/demo') is false", () => {
    expect(isProtectedPath('/demo')).toBe(false)
  })
})
