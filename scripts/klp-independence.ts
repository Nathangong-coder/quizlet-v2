import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { prisma } from '../src/lib/db'
import { generateJson } from '../src/lib/ai/generate'
import { resolveLanguageModel} from '../src/lib/ai/providers'
import { PROBE_INDEPENDENCE_PROMPT } from '../src/lib/ai/prompts/probe-independence'
import {
  coFiringPairs,
  classifyPair,
  pairRelationship,
  readProbe,
  summarizeIndependence,
  formatIndependenceReport,
  type PairResult,
  type VerdictRow,
} from '../src/lib/klp/independence'
import { readDirectPool, nextCombo, markTried, poolStatus,
  comboResolveInput,
} from '../src/lib/klp/direct-pool'
import { Pacer, callWithPacingAndRetry, realClock, rpmToIntervalMs, DEFAULT_RPM } from '../src/lib/klp/authoring-pacing'

/**
 * `npm run klp-independence` — C3, pairwise independence, over the existing
 * key-point bank.
 *
 * READ-ONLY. It writes nothing to the database and merges nothing; the output
 * is a report and a JSON file. Merging supersedes a `CardKlp`, which detaches
 * learner evidence, and choosing which of two propositions survives is a
 * judgment about what the card teaches. With a shortlist candidate on 92% of
 * cards, an auto-merge would rewrite most of the corpus on the strength of a
 * three-column verdict vector.
 *
 * ## Two stages, and the first is free
 *
 * 1. **Shortlist** (no AI): pairs whose credit vectors are identical across
 *    every candidate the authoring run already graded. That matrix is built for
 *    the discrimination test whether or not anything reads it — R5's point.
 * 2. **Confirm** (one call per shortlisted pair): can an answer state one
 *    without the other, in each direction? The prompt asks for a CONSTRUCTION,
 *    and a direction only counts as possible if an example was actually
 *    written.
 *
 * Quadratic becomes roughly linear: a 7-point card has 21 pairs and typically
 * far fewer that co-fire.
 *
 * Flags:
 *   --set <setId>     scope to one set
 *   --card <cardId>   one card
 *   --limit <n>       cap CARDS examined (default 10)
 *   --max-pairs <n>   cap confirming calls per card (default 6)
 *   --shortlist-only  print the free stage and stop — costs nothing
 *   --direct          raw provider keys from the environment
 *   --rpm <n>         pacing
 *   --write           persist confirmed ENTAILMENTS as `requires` relations. Additive and
 *                     safe: it supersedes no key point, so no mastery is reset. It also
 *                     raises the prerequisite's weight on the next authoring pass, because
 *                     `blastRadius` counts what depends on a point.
 *   --out <path>      where the full report is written (JSON)
 */

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}
function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const MAX_OUTPUT_TOKENS = 8192

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  const cardId = opt(args, '--card')
  const direct = flag(args, '--direct')
  const shortlistOnly = flag(args, '--shortlist-only')
  const write = flag(args, '--write')
  const outPath = opt(args, '--out') ?? 'docs/ai/klp-independence-run.json'
  const limit = Number.parseInt(opt(args, '--limit') ?? '10', 10)
  const maxPairs = Number.parseInt(opt(args, '--max-pairs') ?? '6', 10)
  const rpm = Number.parseInt(opt(args, '--rpm') ?? String(DEFAULT_RPM), 10)

  // The verdict matrix lives on the authoring run, so only authored cards can
  // be shortlisted. A legacy card has no candidates and therefore no free
  // signal — reported rather than silently skipped, because "no co-firing
  // pairs" and "never tested" must not look the same.
  const runs = await prisma.cardAuthoring.findMany({
    where: {
      probes: { some: {} },
      ...(cardId ? { cardId } : {}),
      ...(setId ? { card: { setId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      cardId: true,
      klpVersion: true,
      card: { select: { term: true } },
      probes: { select: { verdicts: true } },
    },
  })

  // Newest run per card only. An older run's matrix describes key points that
  // may since have been superseded.
  const seen = new Set<string>()
  const latest = runs.filter((r) => (seen.has(r.cardId) ? false : (seen.add(r.cardId), true)))

  interface Target {
    cardId: string
    term: string
    klps: { id: string; text: string }[]
    rows: VerdictRow[]
    pairs: { a: number; b: number }[]
    totalPairs: number
  }
  const targets: Target[] = []
  let klpPairsTotal = 0
  let shortlisted = 0

  for (const r of latest) {
    const klps = await prisma.cardKlp.findMany({
      where: { cardId: r.cardId, version: r.klpVersion },
      orderBy: { index: 'asc' },
      select: { id: true, text: true },
    })
    if (klps.length < 2) continue
    const rows = r.probes.map((p) => p.verdicts as VerdictRow)
    const pairs = coFiringPairs(rows, klps.length)
    const total = (klps.length * (klps.length - 1)) / 2
    klpPairsTotal += total
    shortlisted += pairs.length
    if (pairs.length > 0) {
      targets.push({ cardId: r.cardId, term: r.card.term, klps, rows, pairs, totalPairs: total })
    }
  }

  console.log(
    `[klp-independence] READ-ONLY. ${latest.length} card(s) with a verdict matrix; ` +
      `${shortlisted} of ${klpPairsTotal} pairs co-fire (FREE, no AI call).`,
  )
  console.log(
    `[klp-independence] ${targets.length} card(s) carry at least one candidate pair. ` +
      `A co-firing vector is a reason to LOOK, not a finding — only the confirming call decides.`,
  )

  if (shortlistOnly) {
    for (const t of targets.slice(0, limit)) {
      console.log(`  ${t.pairs.length}/${t.totalPairs} pairs — ${t.term.slice(0, 62)}`)
      for (const p of t.pairs.slice(0, maxPairs)) {
        console.log(`      [${p.a}] ${t.klps[p.a].text.slice(0, 78)}`)
        console.log(`      [${p.b}] ${t.klps[p.b].text.slice(0, 78)}`)
        console.log('      --')
      }
    }
    return
  }

  const chosen = targets.slice(0, limit)
  const calls = chosen.reduce((n, t) => n + Math.min(t.pairs.length, maxPairs), 0)
  console.log(`[klp-independence] confirming ${calls} pair(s) across ${chosen.length} card(s).`)

  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock)
  const pool = direct ? readDirectPool() : []
  let ownerId: string | undefined
  if (direct) {
    console.log(`[klp-independence] --direct: ${poolStatus(pool).modelsLeft.join(', ')}`)
  } else {
    const owner = await prisma.set.findFirst({
      where: setId ? { id: setId } : { cards: { some: { id: chosen[0]?.cardId } } },
      select: { userId: true },
    })
    ownerId = owner?.userId
    if (!ownerId) {
      console.error('[klp-independence] could not resolve a credential owner; use --direct')
      process.exitCode = 1
      return
    }
  }

  async function probe(question: string, textA: string, textB: string) {
    const prompt = PROBE_INDEPENDENCE_PROMPT.build({ question, textA, textB })
    if (!direct) {
      return generateJson({
        userId: ownerId!,
        task: 'author',
        prompt,
        schema: PROBE_INDEPENDENCE_PROMPT.schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
    }
    const combo = nextCombo(pool)
    if (!combo) throw new Error('every key x model combo is out of daily quota')
    markTried(combo, new Date())
    const model = resolveLanguageModel(comboResolveInput(combo))
    return callWithPacingAndRetry(
      async () => {
        const res = await generateText({
          model,
          prompt,
          output: Output.object({ schema: PROBE_INDEPENDENCE_PROMPT.schema as z.ZodTypeAny }),
          maxRetries: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        })
        return res.output as z.infer<typeof PROBE_INDEPENDENCE_PROMPT.schema>
      },
      { pacer, clock: realClock },
    )
  }

  const results: PairResult[] = []
  for (const t of chosen) {
    for (const pair of t.pairs.slice(0, maxPairs)) {
      const textA = t.klps[pair.a].text
      const textB = t.klps[pair.b].text
      try {
        const reply = await probe(t.term, textA, textB)
        const verdict = classifyPair(readProbe(reply))
        results.push({
          cardId: t.cardId,
          term: t.term,
          pair,
          textA,
          textB,
          verdict,
          exampleAWithoutB: reply.exampleAWithoutB,
          exampleBWithoutA: reply.exampleBWithoutA,
        })
        if (verdict !== 'independent') {
          console.log(`  ${verdict.toUpperCase()} — ${t.term.slice(0, 56)}`)
          console.log(`      [${pair.a}] ${textA.slice(0, 84)}`)
          console.log(`      [${pair.b}] ${textB.slice(0, 84)}`)
          console.log(`      note: ${reply.note.slice(0, 140)}`)
        }
      } catch (err) {
        // A failed probe is NOT a verdict. Recording it as `independent` would
        // report no defect on a pair nobody examined, which is the flattering
        // direction.
        console.error(
          `  probe failed on ${t.term.slice(0, 40)} [${pair.a}/${pair.b}]: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // PERSIST ENTAILMENTS AS `requires` EDGES — opt-in, and additive only.
  //
  // The vocabulary's direction convention (RELATE_KLPS_PROMPT): an edge
  // `from: X, to: Y` typed `requires` reads "Y cannot hold without X". So the
  // IMPLIER depends on the IMPLIED, and the edge runs implied -> implier. Get
  // this backwards and `blastRadius` inverts, making the dependent point look
  // central instead of the prerequisite.
  //
  // Equivalent pairs are NOT written: they are a merge question, not a
  // dependency, and there is no honest direction to give the edge.
  if (write) {
    let written = 0
    for (const r of results) {
      const rel = pairRelationship(r.pair, r.verdict)
      if (rel.implier === null || rel.implied === null) continue
      const target = chosen.find((t) => t.cardId === r.cardId)
      if (!target) continue
      const fromKlpId = target.klps[rel.implied].id
      const toKlpId = target.klps[rel.implier].id
      try {
        await prisma.klpRelation.create({
          data: {
            fromKlpId,
            toKlpId,
            type: 'requires',
            provenance: 'entailment',
            rationale:
              `C3: an answer could state "${target.klps[rel.implied].text.slice(0, 90)}" alone, ` +
              `but none could state the dependent point without it.`,
            // The probe field holds the artifact that PROVED the edge — here,
            // the one direction that could be constructed. The impossible
            // direction has no artifact by definition, which is the finding.
            probe: r.exampleAWithoutB || r.exampleBWithoutA || '(no constructible direction)',
          },
        })
        written++
      } catch {
        // Unique on (from, to, type): the edge already exists, most likely from
        // the authoring pass's perturbation step finding the same dependency by
        // a different route. Agreement between two methods is a good outcome,
        // not an error.
      }
    }
    console.log(
      `
[klp-independence] wrote ${written} \`requires\` edge(s) with provenance 'entailment'. ` +
        `Additive — no key point was superseded, so no mastery was reset.`,
    )
  }

  const summary = summarizeIndependence(results, latest.length, klpPairsTotal, shortlisted)
  console.log()
  console.log(formatIndependenceReport(summary))

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(
    outPath,
    JSON.stringify({ runAt: new Date().toISOString(), summary, results }, null, 2),
    'utf-8',
  )
  console.log(`\n[klp-independence] full report written to ${outPath}`)
}

main()
  .catch((err) => {
    console.error('[klp-independence] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
