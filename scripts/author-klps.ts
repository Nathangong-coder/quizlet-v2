import { resolveLanguageModel} from '../src/lib/ai/providers'
import { generateText, Output, NoObjectGeneratedError } from 'ai'
import type { z } from 'zod'
import { prisma } from '../src/lib/db'
import { generateJson, generateJsonWithMeta } from '../src/lib/ai/generate'
import { authorCard, authorMinKlps, type AuthoringGenerator, type AuthoringOutcome, type AuthorResult } from '../src/lib/klp/authoring'
import { writeFileSync } from 'node:fs'
import { persistAuthoring } from '../src/lib/klp/authoring-persist'
import { AUTHOR_KLPS_PROMPT, AUTHOR_KLPS_BATCH_PROMPT } from '../src/lib/ai/prompts/author-klps'
import { isDeepSeekPeak } from '../src/lib/klp/token-meter'
import { GRADE_CANDIDATE_PROMPT } from '../src/lib/ai/prompts/grade-candidate'
import { REVISE_KLPS_PROMPT } from '../src/lib/ai/prompts/revise-klps'
import { RELATE_KLPS_PROMPT } from '../src/lib/ai/prompts/relate-klps'
import { CLASSIFY_ABSTRACTION_PROMPT } from '../src/lib/ai/prompts/classify-abstraction'
import { WRITE_PANEL_PROMPT } from '../src/lib/ai/prompts/write-panel'
import { WRITE_ADVERSARIES_PROMPT } from '../src/lib/ai/prompts/write-adversaries'
import { WRITE_REBUILD_PROMPT, GRADE_COVERAGE_PROMPT, GRADE_PARITY_PROMPT } from '../src/lib/ai/prompts/rebuild'
import { REVIEW_REFERENCE_PROMPT, REVISE_REFERENCE_PROMPT, REVIEW_REBUILT_PROMPT } from '../src/lib/ai/prompts/review-reference'
import { CLASSIFY_ROLES_PROMPT } from '../src/lib/ai/prompts/classify-roles'
import { REBUILD_COVERAGE_BAR, REBUILD_PARITY_BAR } from '../src/lib/klp/rebuild'
import { TokenMeter } from '../src/lib/klp/token-meter'
import { parseRotationSpec, pickRoles, markRoles, familyOf, familiesAvailable, type RotationCombo, type RoleAssignment } from '../src/lib/klp/rotation'
import { DIRECT_PROVIDER_SOURCES, buildDirectPool, parseList } from '../src/lib/klp/direct-pool'
import { findExistingPanel } from '../src/lib/klp/panel-reuse'
import type { CardKlpStatus } from '../src/lib/cards/klp-status'
import {
  buildWeightHistogram,
  diagnoseWeightHistogram,
  buildBreadthHistogram,
  failCountsFromVerdicts,
  formatWeightHistogram,
  formatBreadthHistogram,
} from '../src/lib/klp/histogram'
import { PROBE_KINDS } from '../src/lib/klp/authoring-config'
import { formatPanelCurve } from '../src/lib/klp/panel'
import {
  readDirectPool,
  nextCombo,
  markTried,
  markExhausted,
  poolStatus,
  type DirectCombo,
  comboResolveInput,
} from '../src/lib/klp/direct-pool'
import {
  Pacer,
  RunHaltedError,
  callWithPacingAndRetry,
  realClock,
  rpmToIntervalMs,
  DEFAULT_RPM,
} from '../src/lib/klp/authoring-pacing'

/**
 * Runs the full KLP authoring pipeline (`src/lib/klp/authoring.ts`) against
 * one set's cards, one card at a time, persisting each outcome
 * (`src/lib/klp/authoring-persist.ts`).
 *
 * `--set <setId>` is REQUIRED and this NEVER walks the corpus — a later spec
 * owns bulk authoring. This is a pilot / operator tool for one set at a time.
 */

/**
 * The production generator, wired to the user's own stored `AiCredential`
 * pool via `generateJson` and the four authoring prompts.
 *
 * `AuthorInput.question` (the orchestrator's name for "the thing being
 * asked") is the flashcard's TERM — everything downstream (grade/revise/
 * relate) already calls it `question`, matching the orchestrator, so those
 * three build inputs pass `input.question` straight through. Only Call A's
 * builder (`AuthorKlpsBuildInput`) uses the card-shaped name `term` — it
 * mirrors the legacy extractor's `{ term, definition }` cards, since it is
 * building the reference answer from the card itself, not yet "the
 * question". That is the one seam that needs an explicit rename.
 */
function defaultGenerator(userId: string, onModel?: (model: string) => void): AuthoringGenerator {
  return {
    author: async (input) => {
      // The AUTHOR call is the one whose model is worth recording: it writes
      // the key points. Rotation does not hide which model served it — by the
      // time the value is in hand exactly one attempt succeeded, and
      // `generateJsonWithMeta` reports it.
      const { value, meta } = await generateJsonWithMeta({
        userId,
        task: 'author',
        prompt: AUTHOR_KLPS_PROMPT.build({
          setTitle: input.setTitle,
          term: input.question,
          definition: input.definition,
          minKlps: input.minKlps,
        }),
        schema: AUTHOR_KLPS_PROMPT.schema,
      })
      onModel?.(meta.model)
      return value
    },
    grade: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: GRADE_CANDIDATE_PROMPT.build(input),
        schema: GRADE_CANDIDATE_PROMPT.schema,
      }),
    revise: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: REVISE_KLPS_PROMPT.build(input),
        schema: REVISE_KLPS_PROMPT.schema,
      }),
    relate: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: RELATE_KLPS_PROMPT.build(input),
        schema: RELATE_KLPS_PROMPT.schema,
      }),
    classifyAbstraction: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: CLASSIFY_ABSTRACTION_PROMPT.build(input),
        schema: CLASSIFY_ABSTRACTION_PROMPT.schema,
      }),
    writePanel: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: WRITE_PANEL_PROMPT.build(input),
        schema: WRITE_PANEL_PROMPT.schema,
      }),
  }
}

/**
 * `--direct` runs against a raw `GOOGLE_API_KEY` instead of the user's stored
 * credentials, for one situation only: `GOOGLE_KEY_ENCRYPTION_SECRET` locally
 * is not the secret those credentials were encrypted with, so every decrypt
 * throws and the feature cannot be exercised at all here. Bypasses the
 * credential pool, and therefore also rotation, per-user billing and failure
 * classification — an operator tool, never a code path the app uses. Writes
 * NOTHING to `AiCredential`.
 *
 * Same rename seam as `defaultGenerator`: `input.question` maps onto
 * `AuthorKlpsBuildInput.term` for Call A only.
 *
 * Pacing and retry-honoring (`src/lib/klp/authoring-pacing.ts`) live here,
 * not in `defaultGenerator` — the credential pool already has its own
 * rotation/failover in `src/lib/ai/generate.ts`, and this path is the one
 * that failed on every card of the pilot with no pacing at all. ONE `Pacer`
 * is created per `directGenerator()` call (i.e. per script run) and shared
 * across every `author`/`grade`/`revise`/`relate` call it makes, so the
 * minimum spacing applies WITHIN a card's 6-16 calls, not just between
 * cards — that's where the pilot's burst actually was.
 */
/**
 * A generator pinned to ONE key+model combo, for ONE card.
 *
 * The pin is deliberate — see `src/lib/klp/direct-pool.ts`. A card's separation
 * score is a subtraction between candidates graded in separate calls, so
 * grading them with different models would fold the gap between two graders
 * into the number that is supposed to measure the gap between a strong and a
 * weak answer.
 *
 * The `Pacer` is passed IN rather than created here, so one instance spans the
 * whole run: pacing exists because a single card fires 6-16 calls back to back,
 * and a per-card pacer would reset that spacing at every card boundary.
 */
/**
 * Builds the rotation pool from `KLP_ROTATION` (`source:model,model;source:model;...`),
 * attaching each source's keys, base URL and request defaults exactly as
 * `readDirectPool` would. Every combo carries its family so `pickRoles` can
 * keep the three roles apart.
 */
function readRotationPool(env: NodeJS.ProcessEnv = process.env): RotationCombo[] {
  const spec = parseRotationSpec(env.KLP_ROTATION)
  const pool: RotationCombo[] = []
  const bySource = new Map<string, string[]>()
  for (const { source, model } of spec) bySource.set(source, [...(bySource.get(source) ?? []), model])
  for (const [source, models] of bySource) {
    const src = DIRECT_PROVIDER_SOURCES[source]
    if (!src) throw new Error(`KLP_ROTATION: unknown source "${source}" — use one of ${Object.keys(DIRECT_PROVIDER_SOURCES).join(', ')}`)
    const keys = [...new Set(src.keyVars.flatMap((v) => parseList(env[v])))]
    if (keys.length === 0) throw new Error(`KLP_ROTATION: source "${source}" needs ${src.keyVars.join(' or ')} in the environment`)
    for (const c of buildDirectPool(keys, models, src.resolveAs ?? source, src.baseUrl, src.requestDefaults?.(env), src.schemaInPrompt)) {
      pool.push({ ...c, id: `${source}:${c.id}`, source, family: familyOf(source) })
    }
  }
  return pool
}

/** Run-level knobs read once; see `.env.example`. */
const REVISE_WITH_GRADER = (process.env.KLP_REVISE_WITH ?? '').toLowerCase() === 'grader'
const ADVERSARIES_WITH_GRADER = (process.env.KLP_ADVERSARIES_WITH ?? '').toLowerCase() === 'grader'
const GRADE_STRICT = (process.env.KLP_GRADE_STRICT ?? '').toLowerCase() === 'true'
/** KLP_COMMS_CHECK=false turns off the communication check (on by default from 2026-09-13). */
const COMMS_CHECK = (process.env.KLP_COMMS_CHECK ?? 'true').toLowerCase() !== 'false'

/** One meter for the whole run; printed at the end and written to --json. */
const METER = new TokenMeter()

/**
 * KLP_AUTHOR_BATCH (2026-09-13, cost item 4): author up to N cards per writer
 * call. Drafts are cached here by card content and served to `author`; a
 * card whose draft the batch reply did not carry falls back to a single call.
 * 1 (default) is the old behaviour.
 */
const AUTHOR_BATCH = Math.max(1, Math.min(10, Number(process.env.KLP_AUTHOR_BATCH ?? '1') || 1))
const DRAFTS = new Map<string, AuthorResult>()
const draftKey = (question: string, definition: string) => `${question}\u0000${definition}`

function directGenerator(combo: DirectCombo, pacer: Pacer, authorCombo?: DirectCombo, adversaryCombo?: DirectCombo, rebuildTest = false): AuthoringGenerator {
  // KLP_ADVERSARIES_WITH=grader: in the two-pool split, the grader combo also
  // writes the traps with the independent prompt (question + reference only),
  // so they are not tuned to the key points even without a third family.
  if (!adversaryCombo && ADVERSARIES_WITH_GRADER && authorCombo) adversaryCombo = combo
  // Built through the SAME `resolveLanguageModel` the website uses, not a
  // provider factory called here. That function carries per-provider
  // corrections this script would otherwise have to duplicate — most
  // importantly DeepSeek's `/responses` endpoint and reasoning-off default,
  // without which every authoring call spends its output budget on invisible
  // thinking and returns `schema_invalid`.
  const languageModel = resolveLanguageModel(comboResolveInput(combo))
  // ROLE SEPARATION (2026-09-12): `author` and `revise` — the writing calls —
  // go to the author combo when one is configured (`KLP_AUTHOR_PROVIDER`);
  // grading, relating, classifying and the panel stay on `combo`. Both are
  // pinned for the card. The adversaries are still written by the author
  // call, so they are now graded by a DIFFERENT model than wrote them.
  const writerModel = authorCombo ? resolveLanguageModel(comboResolveInput(authorCombo)) : languageModel
  const adversaryModel = adversaryCombo ? resolveLanguageModel(comboResolveInput(adversaryCombo)) : undefined

  // generateObject does not exist in AI SDK v7; structured output is
  // generateText + Output.object.
  async function call<T>(prompt: string, schema: z.ZodSchema<T>, who: 'writer' | 'grader' | 'adversary' = 'grader', step = 'other'): Promise<T> {
    const target = who === 'writer' ? authorCombo ?? combo : who === 'adversary' && adversaryCombo ? adversaryCombo : combo
    // A quota halt must retire the combo that HIT the quota. Before this tag,
    // a Gemini writer's daily cap retired the DeepSeek grader combo (the only
    // one in that pool) and stopped a whole run at card 10 of 82 with the
    // grader untouched (2026-09-12).
    try {
      return await callWithPacingAndRetry(
      async () => {
        // maxRetries: 0 — THE PACING LAYER OWNS RETRY, and two retry
        // authorities multiply rather than compose. The SDK's default is 2
        // (three attempts), so a rate-limited call cost 3 real requests before
        // `callWithPacingAndRetry` ever saw the error, and its own 8 attempts
        // therefore spent up to 24. Against a 20-requests-per-DAY free tier
        // that is the entire day's budget burned retrying a wall. It also
        // delayed classification: the daily-quota halt cannot fire until the
        // error surfaces, and the SDK swallowed the first two.
        const model = who === 'writer' ? writerModel : who === 'adversary' && adversaryModel ? adversaryModel : languageModel
        const attempt = () => generateText({ model, prompt, output: Output.object({ schema }), maxRetries: 0 })
        let res: Awaited<ReturnType<typeof attempt>>
        try {
          res = await attempt()
        } catch (err) {
          // ONE immediate retry on a malformed reply (2026-09-13). A structured-
          // output failure used to fail the CARD — "trying another model" — and
          // with one combo in the pool that re-ran every call the card had
          // already spent (a sell-side card lost ~10 grades to one bad JSON).
          // The reply is stochastic; the same prompt almost always parses on
          // the second try, and one call is cheaper than a card.
          if (!NoObjectGeneratedError.isInstance(err)) throw err
          console.log(`[author-klps] ${step} on ${target.model}: malformed reply (${err.finishReason ?? 'no finish reason'}); retrying once`)
          await pacer.waitTurn()
          res = await attempt()
        }
        // Metered on success only; a failed attempt's usage is not reported
        // by the SDK, so the meter understates retries — say so when reading it.
        METER.add(step, target.model, {
          inputTokens: res.usage?.inputTokens,
          outputTokens: res.usage?.outputTokens,
          reasoningTokens: res.usage?.outputTokenDetails?.reasoningTokens,
          cachedTokens: res.usage?.inputTokenDetails?.cacheReadTokens,
        })
        return res.output
      },
      {
        pacer,
        clock: realClock,
        onRetryWait: ({ attempt, waitMs, kind }) =>
          console.log(
            `[author-klps] ${kind} — retry ${attempt}, waiting ${(waitMs / 1000).toFixed(1)}s ` +
              `(honoring the provider's own hint when it gave one)`,
          ),
      },
    )
    } catch (err) {
      if (err instanceof RunHaltedError) (err as RunHaltedError & { role?: 'writer' | 'grader' | 'adversary' }).role = who
      throw err
    }
  }

  return {
    author: async (input) => {
      const cached = DRAFTS.get(draftKey(input.question, input.definition))
      if (cached) {
        DRAFTS.delete(draftKey(input.question, input.definition))
        return cached
      }
      return call(
        AUTHOR_KLPS_PROMPT.build({
          setTitle: input.setTitle,
          term: input.question,
          definition: input.definition,
          minKlps: input.minKlps,
        }),
        AUTHOR_KLPS_PROMPT.schema,
        'writer',
        'author',
      )
    },
    authorBatch: (input) =>
      call(
        AUTHOR_KLPS_BATCH_PROMPT.build({
          setTitle: input.setTitle,
          cards: input.cards.map((c) => ({ ref: c.ref, term: c.question, definition: c.definition, minKlps: c.minKlps })),
        }),
        AUTHOR_KLPS_BATCH_PROMPT.schema,
        'writer',
        'author-batch',
      ),
    grade: (input) => call(GRADE_CANDIDATE_PROMPT.build({ ...input, strict: GRADE_STRICT }), GRADE_CANDIDATE_PROMPT.schema, 'grader', 'grade'),
    // KLP_REVISE_WITH=grader: the bar's revise calls go to the grader combo
    // instead of the writer (the owner's "GLM writes, DeepSeek revises").
    revise: (input) => call(REVISE_KLPS_PROMPT.build(input), REVISE_KLPS_PROMPT.schema, REVISE_WITH_GRADER ? 'grader' : 'writer', 'revise'),
    relate: (input) => call(RELATE_KLPS_PROMPT.build(input), RELATE_KLPS_PROMPT.schema, 'grader', 'relate'),
    classifyAbstraction: (input) =>
      call(CLASSIFY_ABSTRACTION_PROMPT.build(input), CLASSIFY_ABSTRACTION_PROMPT.schema, 'grader', 'classify'),
    writePanel: (input) => call(WRITE_PANEL_PROMPT.build(input), WRITE_PANEL_PROMPT.schema, 'grader', 'panel'),
    ...(adversaryCombo
      ? { writeAdversaries: (input) => call(WRITE_ADVERSARIES_PROMPT.build(input), WRITE_ADVERSARIES_PROMPT.schema, 'adversary', 'adversaries') }
      : {}),
    // Framing, judged: the grader labels each point; overrides the rule.
    classifyRoles: (input) => call(CLASSIFY_ROLES_PROMPT.build(input), CLASSIFY_ROLES_PROMPT.schema, 'grader', 'roles'),
    // The communication check: the GRADER reviews, the WRITER rewrites.
    ...(COMMS_CHECK
      ? {
          reviewReference: (input) => call(REVIEW_REFERENCE_PROMPT.build(input), REVIEW_REFERENCE_PROMPT.schema, 'grader', 'review'),
          reviseReference: (input) => call(REVISE_REFERENCE_PROMPT.build(input), REVISE_REFERENCE_PROMPT.schema, 'writer', 'revise-ref'),
          reviewRebuilt: (input) => call(REVIEW_REBUILT_PROMPT.build(input), REVIEW_REBUILT_PROMPT.schema, 'grader', 'review-rebuilt'),
        }
      : {}),
    // The rebuild test. The REBUILDER is the adversary combo when one exists
    // (a different family than the writer, by construction) and otherwise
    // the grader combo — a documented compromise for the two-pool split,
    // where no third family is configured. Coverage and parity are graded
    // by the grader.
    ...(rebuildTest
      ? {
          rebuild: (input) => call(WRITE_REBUILD_PROMPT.build(input), WRITE_REBUILD_PROMPT.schema, adversaryCombo ? 'adversary' : 'grader', 'rebuild'),
          gradeCoverage: (input) => call(GRADE_COVERAGE_PROMPT.build({ ...input, strict: GRADE_STRICT }), GRADE_COVERAGE_PROMPT.schema, 'grader', 'coverage'),
          gradeParity: (input) => call(GRADE_PARITY_PROMPT.build({ ...input, strict: GRADE_STRICT }), GRADE_PARITY_PROMPT.schema, 'grader', 'parity'),
        }
      : {}),
  }
}

/**
 * How many key x model combos one card may be tried on before it is recorded as
 * failed.
 *
 * Bounds the model-capability retry above. A card that is genuinely unauthorable
 * would otherwise walk the entire pool proving it, spending the day's budget on
 * the one card that cannot use it. Three is enough to clear a single weak model
 * without turning a real failure into an expensive one.
 */
const MAX_COMBO_ATTEMPTS_PER_CARD = 3

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

interface RunStats {
  /** Cards the quality bar sent through at least one revision. */
  revised: number
  authored: number
  lowDiscrimination: number
  /** Cards whose points are mostly framing — a template answers them (2026-09-13). */
  memorizable: number
  totalKlps: number
  totalRelations: number
  separationSum: number
  /** Separation over substance points only (framing excluded); see src/lib/klp/framing.ts. */
  substanceSum: number
  framingPoints: number
  /** Cards whose reference the communication check sent back to the writer. */
  referenceRewritten: number
  parityBelowBar: number
  /** Word ratios (rebuilt / reference) and the reviewer's verdict on the rebuilt answer — the compression acceptance numbers. */
  wordRatios: number[]
  rebuiltTight: number
  rebuiltReviewed: number
  /**
   * Every weight this run computed, and how many adversaries failed each KLP.
   *
   * Collected so the run ends with its own weight histogram
   * (`src/lib/klp/histogram.ts`) rather than only a mean separation. Weight is
   * the number audit finding G1 was about, and a run that produces flat weights
   * has failed at something a per-card summary line cannot show — the shape only
   * exists across cards. `npm run klp-histogram` reads the same distribution
   * back off the database; this is the same check without a second command, on
   * exactly the rows just written.
   */
  weights: number[]
  failCounts: number[]
  probesPerCard: number
  /** Cards whose reference answer flagged something wrong in the owner's own definition. */
  concerns: { term: string; concerns: string[] }[]
  /**
   * Panel separations, when the panel ran. Collected so a CALIBRATION run
   * reports a DISTRIBUTION rather than a mean — a floor has to be set from the
   * shape, and a mean hides whether the spread is tight or bimodal.
   */
  panelSeparations: number[]
  panelNonMonotonic: number
}

/** Best-effort. Never throws — see `extractKlpsForCards`'s identical posture. */
async function markCardFailed(cardId: string, err: unknown): Promise<void> {
  try {
    await prisma.card.update({
      where: { id: cardId },
      data: {
        klpStatus: 'failed' satisfies CardKlpStatus,
        klpError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
      },
    })
  } catch {
    // Nothing more to do.
  }
}

/**
 * Full verbatim printout of one outcome, for `--dry-run` only. The summary
 * line alone (separation/KLP count/relation count) is not enough to judge
 * grain and quality — an operator has to see the actual reference answer,
 * every KLP with its computed weight, the three wrong answers with their
 * per-candidate scores, and every relation with its rationale and probe.
 *
 * `AuthoringOutcome` does not carry the reference candidate's own score
 * directly (only the derived `separationScore`), so it is recovered here as
 * `separationScore + bestWrongScore` — the same arithmetic
 * `computeSeparation` (`src/lib/klp/separation.ts`) already did; this is
 * display-only, not a second computation the pipeline depends on.
 */
function printOutcomeDetail(term: string, outcome: AuthoringOutcome): void {
  console.log(`\n=== ${term} ===`)
  console.log(`-- Reference answer --\n${outcome.referenceAnswer}`)

  console.log(`\n-- KLPs (${outcome.klps.length}, sized for ${outcome.targetKlpCount}) --`)
  console.log('  In delivery order: setup -> mechanism -> payoff, the last one landing the answer.')
  outcome.klps.forEach((k, i) => console.log(`  [${i}] (${k.kind}, weight ${k.weight}) ${k.text}`))

  // Printed per card as well as in the run summary: a --dry-run operator is
  // reading one card at a time and judging it, and "your definition may be
  // wrong" belongs next to the answer built on it.
  if (outcome.concerns.length > 0) {
    console.log(`\n-- Concerns about this card's own definition (NOT applied) --`)
    for (const c of outcome.concerns) console.log(`  - ${c}`)
  }

  console.log(`\n-- Wrong answers (${outcome.probes.length}) --`)
  for (const p of outcome.probes) {
    console.log(`  [${p.kind}] score ${p.score.toFixed(2)}`)
    console.log(`    ${p.text}`)
    console.log(`    verdicts: ${JSON.stringify(p.verdicts)}`)
  }

  // WITH A PANEL, THE OLD NUMBERS ARE MEANINGLESS AND MUST NOT BE PRINTED ALONE.
  // `bestWrongScore` is a max over every non-reference candidate, and under a
  // panel that set includes L4 and L3 - the members that are SUPPOSED to score
  // high. So "best wrong 0.93" is the expert answer being counted as an
  // adversary, and the separation derived from it reads as a catastrophic
  // failure on a card that is fine. The curve is the number that applies.
  if (outcome.panelCurve) {
    console.log(`\n-- Competence panel (revisions: ${outcome.revisions}) --`)
    console.log(formatPanelCurve(outcome.panelCurve))
    const notable = outcome.klpShapes.filter((s) => s.shape !== 'healthy')
    console.log(
      `  per-KLP shapes: ${outcome.klpShapes.length - notable.length} healthy` +
        (notable.length > 0 ? `, ${notable.length} flagged` : ''),
    )
    for (const s of notable) console.log(`    [${s.index}] ${s.shape} - ${s.detail}`)
    for (const b of outcome.unseparatedBoundaries) {
      console.log(
        `    SET-LEVEL: no key point separates ${b.stronger} from ${b.weaker} — this card cannot ` +
          `tell those two competence levels apart however good its individual points look.`,
      )
    }
  } else {
    const bestWrongScore = outcome.probes.length > 0 ? Math.max(...outcome.probes.map((p) => p.score)) : 0
    const referenceScore = outcome.separationScore + bestWrongScore
    console.log(
      `\n-- Separation -- reference ${referenceScore.toFixed(2)}, best wrong ${bestWrongScore.toFixed(2)}, ` +
        `separation ${outcome.separationScore.toFixed(2)} (revisions: ${outcome.revisions})`,
    )
  }

  console.log(
    `\n-- Relations (${outcome.relations.length}) -- ` +
      `candidates ${outcome.relationStats.candidates}, accepted ${outcome.relationStats.accepted}, ` +
      `dropped for cycles ${outcome.relationStats.droppedForCycles}, ` +
      `dropped out-of-range ${outcome.relationStats.droppedOutOfRange}`,
  )
  for (const r of outcome.relations) {
    console.log(`  [${r.from}] --${r.type}--> [${r.to}] (${r.provenance})`)
    console.log(`    rationale: ${r.rationale}`)
    console.log(`    probe: ${r.probe}`)
  }

  if (outcome.defects.length > 0) {
    console.log(`\n-- Validation defects --\n${JSON.stringify(outcome.defects, null, 2)}`)
  }
  console.log(`\nstatus: ${outcome.status}\n===\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  if (!setId) {
    console.error('[author-klps] --set <setId> is required. This tool never walks the whole corpus.')
    process.exitCode = 1
    return
  }

  const direct = flag(args, '--direct')
  // `--rotate`: three roles per card from three model families (`KLP_ROTATION`).
  const rotate = flag(args, '--rotate')
  // `--rebuild`: run the rebuild test (three more calls per card) and persist
  // cardCoverage / referenceParity / cardDisputes.
  const rebuildTest = flag(args, '--rebuild')
  if (rotate && !direct) {
    console.error('[author-klps] --rotate implies --direct (raw keys from the environment); pass both.')
    process.exitCode = 1
    return
  }
  const dryRun = flag(args, '--dry-run')
  const force = flag(args, '--force')
  const limitRaw = opt(args, '--limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined
  // `--skip N` starts N cards into the set, so the SAME cards can be authored
  // by several models for a comparison; `--json <file>` keeps every dry-run
  // outcome verbatim (KLPs, weights, probes, verdicts, relations), rewritten
  // after each card so a killed run loses nothing it paid for.
  const skipRaw = opt(args, '--skip')
  const skip = skipRaw !== undefined ? Number.parseInt(skipRaw, 10) : 0
  const jsonOut = opt(args, '--json')

  const rpmRaw = opt(args, '--rpm')
  const rpm = rpmRaw !== undefined ? Number.parseInt(rpmRaw, 10) : DEFAULT_RPM
  if (!Number.isFinite(rpm) || rpm <= 0) {
    console.error(`[author-klps] --rpm must be a positive number, got ${JSON.stringify(rpmRaw)}`)
    process.exitCode = 1
    return
  }

  if (direct) {
    console.log(
      // Names the PROVIDER actually in use, not a hardcoded "GOOGLE_API_KEY".
      // A run that says it is using Google while billing DeepSeek is exactly
      // the kind of log line that makes a cost surprise take an hour to trace.
      `[author-klps] --direct: using ${(process.env.KLP_DIRECT_PROVIDER ?? 'google').toLowerCase()} ` +
        `keys from the environment, bypassing stored credentials ` +
        `(pacing at ${rpm} req/min, min ${(rpmToIntervalMs(rpm) / 1000).toFixed(2)}s between calls)`,
    )
  }
  if (dryRun) {
    console.log('[author-klps] --dry-run: pipeline will run, nothing will be written')
  }

  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: { id: true, title: true, userId: true },
  })
  if (!set) {
    console.error(`[author-klps] no set found for id ${setId}`)
    process.exitCode = 1
    return
  }

  const allCards = await prisma.card.findMany({
    where: { setId: set.id },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      term: true,
      definition: true,
      position: true,
      klpVersion: true,
      klpStatus: true,
      // Content blocks are part of `klpSourceHash`'s fingerprint (see
      // `persistAuthoring`'s doc comment) — a rich card that omitted them
      // here would hash the same as its own text-only stub, and
      // `selectStaleCardIds` would then treat a real content change (adding
      // or editing a block) as invisible.
      contentBlocks: { select: { side: true, type: true, text: true, assetId: true, position: true } },
    },
  })

  // `--cards id,id,...` picks specific cards from the set (a spread run); wins over --skip/--limit.
  const onlyIds = (opt(args, '--cards') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const cards = onlyIds.length
    ? onlyIds.map((id) => allCards.find((c) => c.id === id)).filter((c): c is (typeof allCards)[number] => !!c)
    : limit !== undefined ? allCards.slice(skip, skip + limit) : allCards.slice(skip)
  const total = cards.length
  const jsonOutcomes: { cardId: string; term: string; model: string | undefined; outcome: unknown }[] = []
  const flushJson = () => {
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ setId: set.id, skip, outcomes: jsonOutcomes, tokens: METER.toJSON() }, null, 2))
  }

  // ONE pacer for the whole run — a card's 6-16 calls are where the burst is,
  // so a per-card pacer would reset the spacing at every card boundary.
  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock, (waitMs) => {
    console.log(`[author-klps] pacing — waiting ${(waitMs / 1000).toFixed(1)}s to stay under ${rpm} req/min`)
  })
  const rotationPool: RotationCombo[] = rotate ? readRotationPool() : []
  if (rotate) {
    const fams = familiesAvailable(rotationPool)
    if (fams.length < 2) {
      console.error(`[author-klps] --rotate needs models from at least two families (google / cn / qwen); KLP_ROTATION gives ${fams.join(', ') || 'none'}`)
      process.exitCode = 1
      return
    }
    console.log(`[author-klps] --rotate: ${rotationPool.length} combo(s) across families ${fams.join(', ')} — writer / adversary / grader from three different families per card`)
  }
  const pool = direct && !rotate ? readDirectPool() : []
  const authorPool = direct && !rotate ? readDirectPool(process.env, 'author') : []
  if (direct && !rotate) {
    const status = poolStatus(pool)
    console.log(
      `[author-klps] --direct pool: ${status.total} key x model combo(s) — ` +
        `${new Set(pool.map((c) => c.keyIndex)).size} key(s), models: ${status.modelsLeft.join(', ')}`,
    )
    if (authorPool.length > 0) {
      console.log(
        `[author-klps] AUTHOR pool (writes + revises): ${authorPool.length} combo(s), ` +
          `models: ${poolStatus(authorPool).modelsLeft.join(', ')} — grading/relating stay on the direct pool`,
      )
    }
  }

  let halted = false
  const stats: RunStats = {
    revised: 0,
    authored: 0,
    lowDiscrimination: 0,
    memorizable: 0,
    totalKlps: 0,
    totalRelations: 0,
    separationSum: 0,
    substanceSum: 0,
    framingPoints: 0,
    referenceRewritten: 0,
    parityBelowBar: 0,
    wordRatios: [],
    rebuiltTight: 0,
    rebuiltReviewed: 0,
    weights: [],
    failCounts: [],
    probesPerCard: PROBE_KINDS.length,
    concerns: [],
    panelSeparations: [],
    panelNonMonotonic: 0,
  }

  // The resumability check, memoised so the batch look-ahead and the loop
  // itself query each card once.
  const skipCache = new Map<string, boolean>()
  async function alreadyAuthored(card: (typeof cards)[number]): Promise<boolean> {
    const hit = skipCache.get(card.id)
    if (hit !== undefined) return hit
    let skip = false
    if (!force && card.klpVersion > 0 && card.klpStatus !== 'failed') {
      const existing = await prisma.cardAuthoring.findFirst({
        where: { cardId: card.id, klpVersion: card.klpVersion },
        select: { id: true },
      })
      skip = !!existing
    }
    skipCache.set(card.id, skip)
    return skip
  }

  if (direct && isDeepSeekPeak(new Date())) {
    console.log('[author-klps] NOTE: DeepSeek PEAK pricing right now (Mon-Fri 01-04 / 06-10 UTC) — every DeepSeek call costs 2x the off-peak rate.')
  }

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const n = i + 1
    const tag = `[${n}/${total}] ${card.term}`

    // RESUMABLE: a card already authored at its current klpVersion is
    // skipped unless --force. A failure partway through a set must not force
    // a full restart, and must not re-spend AI budget on cards already done.
    //
    // `klpStatus !== 'failed'` is belt-and-braces on top of the row check
    // (Fix 1b, review round). `persistAuthoring`'s steps 2-4 now commit
    // atomically (Fix 1a), so a genuinely partial write can no longer leave
    // a `CardAuthoring` row at the card's CURRENT `klpVersion` with no
    // matching content. But the row check alone trusts row existence as
    // proof of success regardless of WHY `klpStatus` currently reads
    // 'failed' — this makes that trust conditional: whatever the reason a
    // card is marked failed, it is retried rather than silently skipped
    // because some CardAuthoring row happens to exist at its current
    // version.
    if (await alreadyAuthored(card)) {
      console.log(`${tag} — skipped (already authored at version ${card.klpVersion})`)
      continue
    }

    // Try this card on successive key x model combos. A per-DAY quota retires
    // the combo it was hit on and the card is re-attempted on the next one —
    // the pool exists exactly so one exhausted bucket does not end the run.
    // Only an empty pool, or a halt that is not a daily cap, stops everything.
    let outcome: AuthoringOutcome | undefined
    let cardFailed = false
    let attemptsLeft = MAX_COMBO_ATTEMPTS_PER_CARD
    // The model that actually produced the outcome, for CardAuthoring.model.
    // Captured per card because the pool rotates between cards.
    let usedModel: string | undefined

    let lastAuthorCombo: DirectCombo | undefined
    for (;;) {
      let gen: AuthoringGenerator
      let combo: DirectCombo | undefined

      let roles: RoleAssignment | undefined
      if (rotate) {
        roles = pickRoles(rotationPool) ?? undefined
        if (!roles) {
          console.error(`\n[author-klps] STOPPING RUN — fewer than two families still have quota.`)
          halted = true
          break
        }
        markRoles(roles, new Date())
        combo = roles.grader
        lastAuthorCombo = roles.writer
        usedModel = `${roles.writer.model}+${roles.adversary.model}+${roles.grader.model}`
        gen = directGenerator(roles.grader, pacer, roles.writer, roles.adversary, rebuildTest)
        console.log(`${tag} — writer ${roles.writer.id}, adversary ${roles.adversary.id}, grader ${roles.grader.id}`)
      } else if (direct) {
        combo = nextCombo(pool)
        if (!combo) {
          console.error(`\n[author-klps] STOPPING RUN — every key x model combo is out of daily quota.`)
          console.error(
            `[author-klps] ${stats.authored}/${total} card(s) completed. Re-run tomorrow, add another ` +
              `model to KLP_DIRECT_MODELS, or raise the key's quota tier — the run resumes where it stopped.`,
          )
          halted = true
          break
        }
        markTried(combo, new Date())
        let authorCombo: DirectCombo | undefined
        lastAuthorCombo = undefined
        if (authorPool.length > 0) {
          authorCombo = nextCombo(authorPool)
          if (!authorCombo) {
            console.error(`\\n[author-klps] STOPPING RUN — every AUTHOR combo is out of daily quota.`)
            halted = true
            break
          }
          markTried(authorCombo, new Date())
          lastAuthorCombo = authorCombo
        }
        // CardAuthoring.model records the WRITER when roles are split — the
        // key points are its text; the grader is recorded in the run log.
        usedModel = authorCombo ? `${authorCombo.model}+${combo.model}` : combo.model
        if (authorCombo && (REVISE_WITH_GRADER || ADVERSARIES_WITH_GRADER || GRADE_STRICT || AUTHOR_BATCH > 1 || COMMS_CHECK)) {
          usedModel += ` [${[REVISE_WITH_GRADER && 'revise=grader', ADVERSARIES_WITH_GRADER && 'adversaries=grader', GRADE_STRICT && 'strict', AUTHOR_BATCH > 1 && `batch=${AUTHOR_BATCH}`, COMMS_CHECK && 'comms'].filter(Boolean).join(',')}]`
        }
        gen = directGenerator(combo, pacer, authorCombo, undefined, rebuildTest)
        console.log(`${tag} — using ${combo.id}${authorCombo ? ` (author ${authorCombo.id})` : ''}`)
      } else {
        gen = defaultGenerator(set.userId, (model) => {
          usedModel = model
        })
      }

      // BATCHED AUTHORING: when this card has no cached draft, write the next
      // AUTHOR_BATCH unskipped cards in one call and cache their drafts. A
      // reply missing a card, or failing the schema, leaves those cards to
      // the single call inside authorCard; a quota halt propagates as usual.
      if (AUTHOR_BATCH > 1 && gen.authorBatch && !DRAFTS.has(draftKey(card.term, card.definition))) {
        const group = [card]
        for (let j = i + 1; j < cards.length && group.length < AUTHOR_BATCH; j++) {
          if (!(await alreadyAuthored(cards[j]))) group.push(cards[j])
        }
        if (group.length > 1) {
          try {
            const reply = await gen.authorBatch({
              setTitle: set.title,
              cards: group.map((c, ref) => ({ ref, question: c.term, definition: c.definition, minKlps: authorMinKlps({ question: c.term, definition: c.definition }) })),
            })
            let served = 0
            for (const d of reply.cards) {
              const c = group[d.ref]
              if (!c) continue
              const draft: AuthorResult & { ref?: number } = { ...d }
              delete draft.ref
              DRAFTS.set(draftKey(c.term, c.definition), draft)
              served += 1
            }
            console.log(`${tag} — batch-authored ${served}/${group.length} cards in one writer call`)
          } catch (err) {
            if (err instanceof RunHaltedError) throw err
            console.log(`${tag} — batch author call failed (${err instanceof Error ? err.message.slice(0, 80) : String(err)}); falling back to single calls`)
          }
        }
      }

      try {
        outcome = await authorCard(
          {
            question: card.term,
            definition: card.definition,
            setTitle: set.title,
            // Reuse this card's existing panel so this run's separation score is
            // comparable with the last one's.
            existingPanel: (await findExistingPanel(card.id))?.members,
          },
          gen,
        )
        break
      } catch (err) {
        // A rate-limit/quota halt is NOT a card failure — the card is left
        // completely untouched (never marked `klpStatus: 'failed'`), so the
        // next attempt (the next combo, or the next invocation of the command)
        // retries this exact card rather than skipping it.
        if (err instanceof RunHaltedError) {
          if (combo && err.haltReason === 'daily_quota') {
            const role = (err as RunHaltedError & { role?: 'writer' | 'grader' | 'adversary' }).role
            if (roles) {
              const hit = role === 'writer' ? roles.writer : role === 'adversary' ? roles.adversary : roles.grader
              markExhausted(hit)
              console.error(`${tag} — ${hit.id} (${role ?? 'grader'}) is out of daily quota; families left: ${familiesAvailable(rotationPool).join(', ')}`)
              continue
            }
            const hit = role === 'writer' && lastAuthorCombo ? lastAuthorCombo : combo
            const hitPool = hit === lastAuthorCombo ? authorPool : pool
            markExhausted(hit)
            console.error(
              `${tag} — ${hit.id} (${role ?? 'grader'}) is out of daily quota; ${poolStatus(hitPool).available} combo(s) left in that pool`,
            )
            continue
          }
          console.error(`\n[author-klps] STOPPING RUN — ${err.message}`)
          console.error(
            `[author-klps] ${stats.authored}/${total} card(s) completed before stopping. ` +
              `Re-run the same command to resume — already-authored cards are skipped automatically.`,
          )
          halted = true
          break
        }
        // NOT a quota problem — the model produced something unusable, most
        // often `No object generated: response did not match schema`. Models
        // differ markedly in structured-output compliance: `gemini-2.5-flash`
        // could not satisfy `AuthorDraftSchema` on a card that
        // `gemini-3.1-flash-lite` authored cleanly minutes later. Retrying the
        // SAME combo would just fail the same way, so the card moves to the
        // next one — routing around a capability gap is what a pool of models
        // is for, and the alternative is marking a perfectly authorable card
        // failed because the first model drawn happened to be the weak one.
        //
        // Bounded, because a card that is genuinely unauthorable would
        // otherwise walk the whole pool and spend the day's budget proving it.
        const detail = err instanceof Error ? err.message : String(err)
        attemptsLeft -= 1
        if (combo && attemptsLeft > 0) {
          console.error(`${tag} — ${combo.id} failed (${detail}); trying another model`)
          continue
        }
        console.error(`${tag} — FAILED: ${detail}`)
        if (!dryRun) await markCardFailed(card.id, err)
        cardFailed = true
        break
      }
    }

    if (halted) break
    if (cardFailed || !outcome) continue

    // Full verbatim detail, not just the summary line: --dry-run exists so an
    // operator can judge grain and quality BEFORE committing real spend
    // across a whole set, which requires seeing the actual artifacts.
    if (dryRun) printOutcomeDetail(card.term, outcome)
    if (outcome.revisionReasons?.length) stats.revised++
    jsonOutcomes.push({ cardId: card.id, term: card.term, model: usedModel, outcome })
    flushJson()

    if (outcome.status === 'failed') {
      // The author call itself produced zero KLPs. This is NOT persisted —
      // `persistAuthoring` -> `writeKlpVersion` would supersede any existing
      // (e.g. legacy-extracted) KLPs with nothing, destructively wiping a
      // card's propositions over a call that produced no usable output.
      console.error(`${tag} — FAILED: author call produced no KLPs`)
      if (!dryRun) await markCardFailed(card.id, new Error('author call produced no KLPs'))
      continue
    }

    try {
      if (!dryRun) {
        await persistAuthoring(
          card.id,
          outcome,
          AUTHOR_KLPS_PROMPT.version,
          { term: card.term, definition: card.definition, blocks: card.contentBlocks },
          usedModel,
        )
      }
    } catch (err) {
      console.error(`${tag} — FAILED to persist: ${err instanceof Error ? err.message : String(err)}`)
      await markCardFailed(card.id, err)
      continue
    }

    const flagSuffix = outcome.status === 'low_discrimination' ? ' [low_discrimination]' : outcome.status === 'memorizable' ? ' [MEMORIZABLE — mostly framing; separation not its verdict]' : ''
    // Relation candidates/accepted/dropped breakdown (Fix 3, review round):
    // printed for every card, not just --dry-run — only the final accepted
    // edge set survived anywhere before this, and telling "genuinely sparse"
    // apart from "over-pruned" needs the numbers behind it, which is exactly
    // what a later multi-card run has to judge.
    console.log(
      `${tag} — ` +
        (outcome.panelCurve
          ? `panel separation ${outcome.panelCurve.separation.toFixed(2)}` +
            `${outcome.panelCurve.monotonic ? '' : ' NON-MONOTONIC'}, `
          : `separation ${outcome.separationScore.toFixed(2)}` +
            (outcome.substanceSeparation !== outcome.separationScore
              ? ` (substance ${outcome.substanceSeparation.toFixed(2)}, ${outcome.klps.filter((k) => k.role === 'framing').length} framing)`
              : '') +
            ', ') +
        `${outcome.klps.length} KLPs, ` +
        (outcome.revisionReasons?.length ? `revised ${outcome.revisionReasons.length}x [${outcome.revisionReasons[0].slice(0, 70)}], ` : '') +
        (outcome.keptRoundReason ? `VETO: ${outcome.keptRoundReason}, ` : '') +
        (outcome.referenceReview
          ? `reference ${outcome.referenceReview.accuracy}/${outcome.referenceReview.conciseness}/${outcome.referenceReview.clarity}${outcome.referenceReview.rewritten ? ' → REWRITTEN' : ''}, `
          : '') +
        (outcome.rebuild
          ? `coverage ${outcome.rebuild.cardCoverage?.toFixed(2) ?? 'n/a'}${outcome.rebuild.clearsBar === false ? ` (BELOW the ${REBUILD_COVERAGE_BAR} bar; missing ${outcome.rebuild.missingPoints.map((i) => `[${i}]`).join('')})` : ''}, ` +
            `parity ${outcome.rebuild.referenceParity?.toFixed(2) ?? 'n/a'}${outcome.rebuild.clearsParityBar === false ? ` (BELOW the ${REBUILD_PARITY_BAR} bar)` : ''}` +
            (outcome.rebuild.wordRatio !== null ? `, rebuilt/ref words ${outcome.rebuild.wordRatio.toFixed(2)}` : '') +
            (outcome.rebuild.review ? ` [rebuilt: ${outcome.rebuild.review.conciseness}/${outcome.rebuild.review.clarity}${outcome.rebuild.review.issues.length ? `, ${outcome.rebuild.review.issues.map((i) => i.kind).join('+')}` : ''}]` : '') +
            (outcome.rebuild.cardDisputes.length ? `, DISPUTES ${outcome.rebuild.cardDisputes.length} — the grader believes the answer over the card: ${outcome.rebuild.cardDisputes.map((d) => `[${d.index}] ${d.reason.slice(0, 80)}`).join(' | ')}` : '') +
            ', '
          : '') +
        `${outcome.relations.length} relations (candidates ${outcome.relationStats.candidates}, ` +
        `cycles-dropped ${outcome.relationStats.droppedForCycles}, ` +
        `out-of-range-dropped ${outcome.relationStats.droppedOutOfRange})${flagSuffix}`,
    )

    stats.authored += 1
    stats.separationSum += outcome.separationScore
    stats.substanceSum += outcome.substanceSeparation
    stats.framingPoints += outcome.klps.filter((k) => k.role === 'framing').length
    if (outcome.referenceReview?.rewritten) stats.referenceRewritten += 1
    if (outcome.rebuild?.clearsParityBar === false) stats.parityBelowBar += 1
    if (outcome.rebuild?.wordRatio != null) stats.wordRatios.push(outcome.rebuild.wordRatio)
    if (outcome.rebuild?.review) {
      stats.rebuiltReviewed += 1
      if (outcome.rebuild.review.conciseness === 'tight') stats.rebuiltTight += 1
    }
    stats.totalKlps += outcome.klps.length
    stats.totalRelations += outcome.relations.length
    if (outcome.status === 'low_discrimination') stats.lowDiscrimination += 1
    if (outcome.status === 'memorizable') stats.memorizable += 1

    stats.weights.push(...outcome.klps.map((k) => k.weight))
    const { failCounts, wrongAnswerCount } = failCountsFromVerdicts(outcome.probes, outcome.klps.length)
    if (wrongAnswerCount > 0) {
      stats.failCounts.push(...failCounts)
      stats.probesPerCard = Math.max(stats.probesPerCard, wrongAnswerCount)
    }
    if (outcome.concerns.length > 0) stats.concerns.push({ term: card.term, concerns: outcome.concerns })
    if (outcome.panelCurve) {
      stats.panelSeparations.push(outcome.panelCurve.separation)
      if (!outcome.panelCurve.monotonic) stats.panelNonMonotonic += 1
    }
  }

  console.log(`[author-klps] tokens by step (successful calls only; list prices, see src/lib/klp/token-meter.ts):\n${METER.format(stats.authored)}`)
  const meanSeparation = stats.authored > 0 ? stats.separationSum / stats.authored : 0
  const meanSubstance = stats.authored > 0 ? stats.substanceSum / stats.authored : 0
  console.log(
    `[author-klps] done — ${stats.authored} cards authored, ${stats.revised} revised by the quality bar` +
      (stats.authored > 0 && stats.revised / stats.authored < 0.2 ? ' (UNDER A FIFTH — the bar found little to fix on this run)' : '') +
      `, mean separation ${meanSeparation.toFixed(2)}` +
      (stats.framingPoints > 0 ? ` (substance ${meanSubstance.toFixed(2)}; ${stats.framingPoints} framing points excluded)` : '') +
      `, ${stats.referenceRewritten} reference(s) rewritten by the communication check, ${stats.parityBelowBar} still below the ${REBUILD_PARITY_BAR} parity bar` +
      (stats.wordRatios.length ? `, rebuilt/ref words mean ${(stats.wordRatios.reduce((a, b) => a + b, 0) / stats.wordRatios.length).toFixed(2)}, rebuilt tight ${stats.rebuiltTight}/${stats.rebuiltReviewed}` : '') +
      `, ${stats.lowDiscrimination} low_discrimination, ${stats.memorizable} memorizable, ${stats.totalKlps} total KLPs, ` +
      `${stats.totalRelations} total relations`,
  )

  if (stats.panelSeparations.length > 0) {
    const sorted = [...stats.panelSeparations].sort((a, b) => a - b)
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
    console.log()
    console.log(
      `[author-klps] PANEL separations — min ${sorted[0].toFixed(2)}, ` +
        `median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}, ` +
        `max ${sorted[sorted.length - 1].toFixed(2)}, mean ${mean.toFixed(2)}; ` +
        `${stats.panelNonMonotonic} non-monotonic`,
    )
    console.log(`  all: ${sorted.map((x) => x.toFixed(2)).join(' ')}`)
    console.log(
      `  The MEAN is not what a floor is set from — read the spread. A floor above the minimum ` +
        `flags that card; one below the maximum passes it.`,
    )
  }

  // The weight histogram, on this run's own output. A run can post a healthy
  // mean separation and still produce a useless weight signal — the two measure
  // different things, and only the distribution shows the second.
  if (stats.weights.length > 0) {
    const hist = buildWeightHistogram(stats.weights)
    console.log()
    console.log(formatWeightHistogram(hist, diagnoseWeightHistogram(hist)))
    console.log()
    console.log(formatBreadthHistogram(buildBreadthHistogram(stats.failCounts, stats.probesPerCard)))
    console.log()
    console.log('Corpus-wide distribution (this run plus everything already stored): npm run klp-histogram')
  }

  // Concerns are printed LAST and never persisted: a pipeline that silently
  // corrects the owner's own cards is worse than one that flags them, because
  // the owner never learns their card was wrong. There is no column for these
  // (increment A adds no migration), so this printout is the only place they
  // exist — which is why they go at the bottom, where a run ends.
  if (stats.concerns.length > 0) {
    console.log()
    console.log(`=== CONCERNS RAISED ABOUT ${stats.concerns.length} CARD DEFINITION(S) ===`)
    console.log('The author call believes these cards say something wrong or incomplete. It did NOT')
    console.log('silently rewrite them — nothing below has been applied to any card.')
    for (const c of stats.concerns) {
      console.log()
      console.log(`  ${c.term}`)
      for (const line of c.concerns) console.log(`    - ${line}`)
    }
  }
}

main()
  .catch((err) => {
    console.error('[author-klps] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
