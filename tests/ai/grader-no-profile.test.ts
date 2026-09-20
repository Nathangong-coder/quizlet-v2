import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Spec 5, "The boundary": the grader is a stateless instrument. It answers
 * "what does this answer contain?", never "what does this person know?" —
 * so the grading prompt module must not be able to see the learner at all.
 * A source scan, because a `profileBlock` field that is merely unused today
 * is one refactor away from being wired back in.
 *
 * The companion assertion below is on the ACTION: `submitShortAnswer` never
 * fetches a profile block either. `safeProfileBlock` legitimately survives
 * elsewhere in the same file (MC distractor GENERATION at
 * `getOrGenerateMultipleChoiceOptions` — steering what to ask is a
 * different job from judging what was answered), so the scan is scoped to
 * the grading action's body, not the module.
 */
const ROOT = join(__dirname, '../..')
const PROFILE = /learnerContextBlock|profileBlock/

/**
 * Slices one top-level `export ... function <name>(` body out of a module:
 * from its declaration to the next top-level `export`. The scan is scoped to
 * the FUNCTION, not the module, because `safeProfileBlock` legitimately
 * survives beside a grading action for GENERATION (MC distractors in
 * `quiz.ts`; game pieces in `games.ts`) — steering what to ask is a different
 * job from judging what was answered.
 */
function exportedFunctionBody(src: string, name: string): string {
  const decl = new RegExp(`^export (?:async )?function ${name}\\(`, 'm')
  const m = decl.exec(src)
  if (!m) throw new Error(`no exported function ${name}`)
  const end = src.indexOf('\nexport ', m.index + 1)
  return src.slice(m.index, end === -1 ? undefined : end)
}

/**
 * Slices one `NAME_PROMPT = { ... build(...) {...} }` object's `build` method
 * body out of a prompt module, from `build(` to the object's closing `};`.
 * Used where a module holds SEVERAL prompts and only the grading one is under
 * the boundary.
 */
function promptBuildBody(src: string, constName: string): string {
  const start = src.indexOf(`export const ${constName} = {`)
  if (start === -1) throw new Error(`no ${constName}`)
  const build = src.indexOf('build(', start)
  const end = src.indexOf('\n};', build)
  if (build === -1 || end === -1) throw new Error(`no build() on ${constName}`)
  return src.slice(build, end)
}

/**
 * Whole modules under the boundary: every prompt that judges an answer. Each
 * must be unable to mention learner context at all.
 */
const GRADING_PROMPT_MODULES = [
  // The runtime short-answer content call.
  'src/lib/ai/prompts/grade-short-answer.ts',
  // The second AI call of the same grading action.
  'src/lib/ai/prompts/annotation.ts',
  // The shared verdict block every grading prompt embeds.
  'src/lib/ai/prompts/verdict-block.ts',
  // The authoring-time candidate grader (traps, rebuild, benchmark panel).
  'src/lib/ai/prompts/grade-candidate.ts',
]

/**
 * Function bodies under the boundary: every ACTION or job that calls a grader.
 * `[file, exported function]`; `'*'` scans the whole module.
 */
const GRADING_CALL_SITES: [string, string][] = [
  ['src/actions/quiz.ts', 'submitShortAnswer'],
  ['src/actions/diagnostic.ts', 'submitDiagnosticTest'],
  ['src/actions/games.ts', 'gradeGameAnswer'],
  ['src/lib/analysis/regrade.ts', '*'],
  ['src/lib/analysis/benchmark-run.ts', '*'],
]

describe('the grader never sees the learner', () => {
  for (const file of GRADING_PROMPT_MODULES) {
    it(`${file} never imports learner context`, () => {
      const src = readFileSync(join(ROOT, file), 'utf-8')
      expect(src).not.toMatch(PROFILE)
    })
  }

  it('DIAGNOSTIC_GRADING_PROMPT.build never reads learner context (the module\'s other prompts may)', () => {
    // `src/lib/ai/prompts/diagnostic.ts` holds three prompts. QUESTION
    // generation and the REPORT are steering and framing — a profile block
    // there is legitimate, exactly as it is for MC distractors. Only the
    // GRADING prompt sits under the boundary, so the scan is scoped to its
    // build body rather than the module.
    const src = readFileSync(join(ROOT, 'src/lib/ai/prompts/diagnostic.ts'), 'utf-8')
    const body = promptBuildBody(src, 'DIAGNOSTIC_GRADING_PROMPT')
    expect(body.length).toBeGreaterThan(50)
    expect(body).not.toMatch(PROFILE)
    // And the grading prompt's INPUT type carries no such field either — the
    // boundary is closed by type, not only by the body's use of it.
    const typeStart = src.indexOf('interface DiagnosticGradingBuildInput')
    expect(typeStart).toBeGreaterThan(-1)
    const typeEnd = src.indexOf('\n}', typeStart)
    expect(src.slice(typeStart, typeEnd)).not.toMatch(PROFILE)
  })

  for (const [file, fn] of GRADING_CALL_SITES) {
    const scope = fn === '*' ? 'the whole module' : `\`${fn}\``
    it(`${file}: ${scope} never fetches a learner profile`, () => {
      const src = readFileSync(join(ROOT, file), 'utf-8')
      const body = fn === '*' ? src : exportedFunctionBody(src, fn)
      expect(body.length).toBeGreaterThan(50)
      expect(body).not.toContain('safeProfileBlock(')
      expect(body).not.toMatch(PROFILE)
    })
  }

  it('the body slicer really isolates one function — the generation path beside it still uses a profile', () => {
    // Guard on the guard: if `exportedFunctionBody` returned the whole module,
    // every call-site assertion above would fail on `quiz.ts`, so passing
    // there proves nothing unless the module as a whole DOES contain the
    // token. It does (MC distractor generation).
    const src = readFileSync(join(ROOT, 'src/actions/quiz.ts'), 'utf-8')
    expect(src).toContain('safeProfileBlock(')
  })
})
