import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every AI call that writes a PERSISTED artifact must record which model wrote
 * it — or say at the call site why it does not.
 *
 * This is a source-level check rather than a behavioural one on purpose. The
 * failure it guards against is an OMISSION: somebody adds a generated artifact,
 * reaches for `generateJson` (which discards the served model), and nothing
 * anywhere fails. `AiCallLog` keeps recording calls, the artifact simply has a
 * null model forever. That is exactly how 320 legacy `CardKlp` rows became
 * unattributable — and unlike an ordinary bug it cannot be fixed afterwards,
 * because the evidence of which model wrote them exists nowhere.
 *
 * The rule is deliberately NOT "always use generateJsonWithMeta". Some calls
 * genuinely have nothing to attribute, and some record the model by another
 * route. What the rule requires is that the choice was made ON PURPOSE and is
 * written where the next author will read it.
 */

const ROOTS = ['src/actions', 'src/lib']

/** Marker a bare `generateJson` call must carry, within MARKER_WINDOW lines above. */
const MARKER = 'ATTRIBUTION:'
const MARKER_WINDOW = 8

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

function bareGenerateJsonCalls(): Array<{ file: string; line: number; explained: boolean }> {
  const found: Array<{ file: string; line: number; explained: boolean }> = []
  for (const root of ROOTS) {
    for (const file of walk(join(process.cwd(), root))) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((text, index) => {
        // `generateJsonWithMeta` contains `generateJson`, so match the bare
        // call specifically. Skip the definition site in generate.ts itself.
        // Skip comments — the name appears in plenty of doc comments, and a
        // comment cannot discard anything.
        const trimmed = text.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        if (!/\bgenerateJson\s*\(/.test(text)) return
        if (/export async function generateJson\b/.test(text)) return
        const window = lines.slice(Math.max(0, index - MARKER_WINDOW), index).join('\n')
        found.push({
          file: file.replace(process.cwd(), '').replace(/\\/g, '/'),
          line: index + 1,
          explained: window.includes(MARKER),
        })
      })
    }
  }
  return found
}

describe('model attribution', () => {
  it('every bare generateJson call states why it discards the served model', () => {
    const unexplained = bareGenerateJsonCalls()
      .filter((call) => !call.explained)
      .map((call) => `${call.file}:${call.line}`)

    expect(
      unexplained,
      `These call generateJson, which throws away the model that served them. ` +
        `Either switch to generateJsonWithMeta and persist meta.model, or write a ` +
        `"// ${MARKER} ..." comment within ${MARKER_WINDOW} lines above saying why ` +
        `this output needs no attribution:\n  ${unexplained.join('\n  ')}`,
    ).toEqual([])
  })

  it('finds call sites at all, so a broken matcher cannot pass vacuously', () => {
    // A regex typo would make the check above trivially green forever.
    expect(bareGenerateJsonCalls().length + explainedCount()).toBeGreaterThan(0)
  })
})

function explainedCount(): number {
  return bareGenerateJsonCalls().filter((call) => call.explained).length
}
