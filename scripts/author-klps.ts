import { createGoogle } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { prisma } from '../src/lib/db'
import { generateJson } from '../src/lib/ai/generate'
import { authorCard, type AuthoringGenerator, type AuthoringOutcome } from '../src/lib/klp/authoring'
import { persistAuthoring } from '../src/lib/klp/authoring-persist'
import { AUTHOR_KLPS_PROMPT } from '../src/lib/ai/prompts/author-klps'
import { GRADE_CANDIDATE_PROMPT } from '../src/lib/ai/prompts/grade-candidate'
import { REVISE_KLPS_PROMPT } from '../src/lib/ai/prompts/revise-klps'
import { RELATE_KLPS_PROMPT } from '../src/lib/ai/prompts/relate-klps'
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
function defaultGenerator(userId: string): AuthoringGenerator {
  return {
    author: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: AUTHOR_KLPS_PROMPT.build({
          setTitle: input.setTitle,
          term: input.question,
          definition: input.definition,
          minKlps: input.minKlps,
        }),
        schema: AUTHOR_KLPS_PROMPT.schema,
      }),
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
function directGenerator(rpm: number): AuthoringGenerator {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('--direct needs GOOGLE_API_KEY in the environment')
  const google = createGoogle({ apiKey })
  const model = process.env.KLP_DIRECT_MODEL ?? 'gemini-3.6-flash'

  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock, (waitMs) => {
    console.log(`[author-klps] pacing — waiting ${(waitMs / 1000).toFixed(1)}s to stay under ${rpm} req/min`)
  })

  // generateObject does not exist in AI SDK v7; structured output is
  // generateText + Output.object.
  async function call<T>(prompt: string, schema: z.ZodSchema<T>): Promise<T> {
    return callWithPacingAndRetry(
      async () => {
        const res = await generateText({ model: google(model), prompt, output: Output.object({ schema }) })
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
  }

  return {
    author: (input) =>
      call(
        AUTHOR_KLPS_PROMPT.build({
          setTitle: input.setTitle,
          term: input.question,
          definition: input.definition,
          minKlps: input.minKlps,
        }),
        AUTHOR_KLPS_PROMPT.schema,
      ),
    grade: (input) => call(GRADE_CANDIDATE_PROMPT.build(input), GRADE_CANDIDATE_PROMPT.schema),
    revise: (input) => call(REVISE_KLPS_PROMPT.build(input), REVISE_KLPS_PROMPT.schema),
    relate: (input) => call(RELATE_KLPS_PROMPT.build(input), RELATE_KLPS_PROMPT.schema),
  }
}

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

interface RunStats {
  authored: number
  lowDiscrimination: number
  totalKlps: number
  totalRelations: number
  separationSum: number
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

  const bestWrongScore = outcome.probes.length > 0 ? Math.max(...outcome.probes.map((p) => p.score)) : 0
  const referenceScore = outcome.separationScore + bestWrongScore
  console.log(
    `\n-- Separation -- reference ${referenceScore.toFixed(2)}, best wrong ${bestWrongScore.toFixed(2)}, ` +
      `separation ${outcome.separationScore.toFixed(2)} (revisions: ${outcome.revisions})`,
  )

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
  const dryRun = flag(args, '--dry-run')
  const force = flag(args, '--force')
  const limitRaw = opt(args, '--limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined

  const rpmRaw = opt(args, '--rpm')
  const rpm = rpmRaw !== undefined ? Number.parseInt(rpmRaw, 10) : DEFAULT_RPM
  if (!Number.isFinite(rpm) || rpm <= 0) {
    console.error(`[author-klps] --rpm must be a positive number, got ${JSON.stringify(rpmRaw)}`)
    process.exitCode = 1
    return
  }

  if (direct) {
    console.log(
      `[author-klps] --direct: using GOOGLE_API_KEY, bypassing stored credentials ` +
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

  const cards = limit !== undefined ? allCards.slice(0, limit) : allCards
  const total = cards.length

  const gen = direct ? directGenerator(rpm) : defaultGenerator(set.userId)

  const stats: RunStats = {
    authored: 0,
    lowDiscrimination: 0,
    totalKlps: 0,
    totalRelations: 0,
    separationSum: 0,
    weights: [],
    failCounts: [],
    probesPerCard: PROBE_KINDS.length,
    concerns: [],
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
    if (!force && card.klpVersion > 0 && card.klpStatus !== 'failed') {
      const existing = await prisma.cardAuthoring.findFirst({
        where: { cardId: card.id, klpVersion: card.klpVersion },
        select: { id: true },
      })
      if (existing) {
        console.log(`${tag} — skipped (already authored at version ${card.klpVersion})`)
        continue
      }
    }

    let outcome: AuthoringOutcome
    try {
      outcome = await authorCard(
        { question: card.term, definition: card.definition, setTitle: set.title },
        gen,
      )
    } catch (err) {
      // A rate-limit/quota halt is NOT a card failure — the card is left
      // completely untouched (never marked `klpStatus: 'failed'`), and the
      // whole run stops here so the next invocation of the same command
      // retries this exact card instead of skipping it (REQUIREMENTS 3 & 4,
      // and the "must stay resumable" constraint).
      if (err instanceof RunHaltedError) {
        console.error(`\n[author-klps] STOPPING RUN — ${err.message}`)
        console.error(
          `[author-klps] ${stats.authored}/${total} card(s) completed before stopping. ` +
            `Re-run the same command to resume — already-authored cards are skipped automatically.`,
        )
        break
      }
      console.error(`${tag} — FAILED: ${err instanceof Error ? err.message : String(err)}`)
      if (!dryRun) await markCardFailed(card.id, err)
      continue
    }

    // Full verbatim detail, not just the summary line: --dry-run exists so an
    // operator can judge grain and quality BEFORE committing real spend
    // across a whole set, which requires seeing the actual artifacts.
    if (dryRun) printOutcomeDetail(card.term, outcome)

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
        await persistAuthoring(card.id, outcome, AUTHOR_KLPS_PROMPT.version, {
          term: card.term,
          definition: card.definition,
          blocks: card.contentBlocks,
        })
      }
    } catch (err) {
      console.error(`${tag} — FAILED to persist: ${err instanceof Error ? err.message : String(err)}`)
      await markCardFailed(card.id, err)
      continue
    }

    const flagSuffix = outcome.status === 'low_discrimination' ? ' [low_discrimination]' : ''
    // Relation candidates/accepted/dropped breakdown (Fix 3, review round):
    // printed for every card, not just --dry-run — only the final accepted
    // edge set survived anywhere before this, and telling "genuinely sparse"
    // apart from "over-pruned" needs the numbers behind it, which is exactly
    // what a later multi-card run has to judge.
    console.log(
      `${tag} — separation ${outcome.separationScore.toFixed(2)}, ${outcome.klps.length} KLPs, ` +
        `${outcome.relations.length} relations (candidates ${outcome.relationStats.candidates}, ` +
        `cycles-dropped ${outcome.relationStats.droppedForCycles}, ` +
        `out-of-range-dropped ${outcome.relationStats.droppedOutOfRange})${flagSuffix}`,
    )

    stats.authored += 1
    stats.separationSum += outcome.separationScore
    stats.totalKlps += outcome.klps.length
    stats.totalRelations += outcome.relations.length
    if (outcome.status === 'low_discrimination') stats.lowDiscrimination += 1

    stats.weights.push(...outcome.klps.map((k) => k.weight))
    const { failCounts, wrongAnswerCount } = failCountsFromVerdicts(outcome.probes, outcome.klps.length)
    if (wrongAnswerCount > 0) {
      stats.failCounts.push(...failCounts)
      stats.probesPerCard = Math.max(stats.probesPerCard, wrongAnswerCount)
    }
    if (outcome.concerns.length > 0) stats.concerns.push({ term: card.term, concerns: outcome.concerns })
  }

  const meanSeparation = stats.authored > 0 ? stats.separationSum / stats.authored : 0
  console.log(
    `[author-klps] done — ${stats.authored} cards authored, mean separation ${meanSeparation.toFixed(2)}, ` +
      `${stats.lowDiscrimination} low_discrimination, ${stats.totalKlps} total KLPs, ` +
      `${stats.totalRelations} total relations`,
  )

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
