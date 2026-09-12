/**
 * PROBE — bottom-up topic minting, DRY RUN. Writes nothing, ever.
 *
 * Named `probe-` deliberately, like `probe-model-policy` and
 * `probe-grading-matrix`: this is a measurement of whether an approach works,
 * not a pipeline. Promote it only once its output has been read by a human.
 *
 * ## What it is testing
 *
 * The live topic layer assigns concepts PER KLP, matched against a reuse
 * vocabulary of up to 150 existing names (`assembleCandidates`) ordered by
 * set-local, then token overlap, then GLOBALLY MOST-LINKED. That last tier is a
 * ratchet: the broadest node is by definition the most-linked, so it is shown
 * most often, so it is reused most often, so it becomes broader still. Measured
 * consequence (2026-09-09): mean KLPs attached directly by tree depth runs
 * 3.4 / 6.2 / 7.9 / 10.3 / 8.1, i.e. the tree funnels NOTHING, and `leverage`
 * holds five unrelated concepts (levered beta, ROE, DSCR, FCCR, growth yield).
 *
 * This probe inverts both halves:
 *
 *   1. **Per CARD, not per KLP.** A card's KLPs already cohere — they were
 *      derived from one reference answer — and that coherence is exactly what
 *      per-KLP matching throws away. Fusing them names the concept the card is
 *      actually about, which is often a concept no existing node covers.
 *   2. **Mint blind.** NO reuse vocabulary is shown. Reconciliation against
 *      existing names is a separate, later, cheaper step (string/embedding work
 *      in TypeScript), and keeping it separate is what removes the ratchet.
 *      Showing the vocabulary at mint time is the thing being tested against.
 *
 * ## The two rules that came from the owner, 2026-09-09
 *
 * **A subtree, not a leaf.** An earlier draft of this fused a card into ONE
 * leaf. Wrong: DSCR and FCCR belong under a shared parent (`debt coverage
 * ratios`) as SEPARATE children, not merged into one `debt service coverage`.
 *
 * **The failure-grain rule, which is why.** *Each specific part a learner can
 * fail must correspond to its own topic.* A learner can get DSCR right and FCCR
 * wrong; merged into one leaf, that shows up as half-credit against a node that
 * names neither failure, and the mastery number stops meaning anything. This is
 * a sharper criterion than any count heuristic — "3-6 KLPs per leaf" is a
 * symptom to observe, independent failability is the actual rule.
 *
 * **Settings get MECHANISM grain, and are kept.** A KLP saying what happens to
 * a statement is not noise to be dropped — the owner wants those links. But
 * `cash flow statement` is the wrong grain for "SBC is added back": the honest
 * concept is `non-cash adjustments`, and for a buyback it is `financing cash
 * flow`. So a setting link is emitted at mechanism grain, as a rank-2 context,
 * never as the subject.
 *
 * ## Usage
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/probe-topic-minting.ts \
 *     --set <setId> [--limit 12] [--json out.json]
 *
 * Reads `GOOGLE_API_KEYS` / `KLP_DIRECT_MODELS` through the same
 * `readDirectPool` the authoring script uses. ONE CALL PER CARD — fusion is the
 * whole point, and batching cards would invite the model to fuse ACROSS cards.
 * Budget accordingly: the free tier is 20 requests per day per model.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import {
  CardTopicProposalSchema,
  buildTopicMintingPrompt,
  EXPECTED_SHAPE,
  type CardTopicProposal,
} from '../src/lib/klp/topic-minting'
import {
  reconcileProposals,
  applyVerdicts,
  normalizeName,
  isContainerName,
  type MergedProposal,
} from '../src/lib/klp/topic-reconcile'
import {
  buildJudgeItems,
  buildJudgePrompt,
  toVerdicts,
  JudgeVerdictSchema,
} from '../src/lib/klp/topic-judge'
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
  callWithPacingAndRetry,
  realClock,
  RunHaltedError,
  DEFAULT_RPM,
  rpmToIntervalMs,
} from '../src/lib/klp/authoring-pacing'

/**
 * Schema and prompt live in `src/lib/klp/topic-minting.ts` (2026-09-11) so the
 * reconciler can share the proposal type. `--dual` below mints each card with
 * DeepSeek AND gemini-3.6-flash, reconciles in TypeScript, and sends only what
 * the rules could not settle to a qwen3.7-flash judge. Design:
 * `docs/superpowers/specs/2026-09-11-dual-model-topic-minting-design.md`.
 */
/** Mirrors `author-klps`. See the loop below for why an unbounded retry is fatal. */
const MAX_COMBO_ATTEMPTS_PER_CARD = 3

/**
 * Progress goes to STDERR, results to stdout.
 *
 * Node fully buffers stdout when it is redirected to a file on Windows, so a
 * long run shows nothing at all until it exits — which is indistinguishable
 * from a hang, and is how the runaway loop above went unnoticed for twelve
 * minutes. stderr is unbuffered.
 */
function progress(line: string): void {
  process.stderr.write(`${line}\n`)
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function flagPresent(args: string[], name: string): boolean {
  return args.includes(name)
}

type ProbeCard = {
  id: string
  term: string
  setTitle: string
  klps: { text: string; kind: string }[]
}

const cardSelect = {
  id: true,
  term: true,
  set: { select: { title: true } },
  klps: {
    where: { supersededAt: null as null },
    orderBy: { index: 'asc' as const },
    select: { text: true, kind: true },
  },
}

/**
 * Mints ONE card on one pool with the same bounded retry the single-model run
 * uses. Returns undefined (and the last error) when the pool could not produce
 * a proposal within `MAX_COMBO_ATTEMPTS_PER_CARD`.
 */
async function mintCard(
  pool: DirectCombo[],
  card: ProbeCard,
  pacer: Pacer,
): Promise<{ proposal?: CardTopicProposal; model?: string; error: string }> {
  const klps = card.klps.map((k, i) => ({ ref: i, text: k.text, kind: k.kind }))
  let attemptsLeft = MAX_COMBO_ATTEMPTS_PER_CARD
  let combo: DirectCombo | undefined
  let lastError = ''
  while (attemptsLeft-- > 0 && (combo = nextCombo(pool))) {
    markTried(combo, new Date())
    try {
      const model = resolveLanguageModel(comboResolveInput(combo))
      const proposal = await callWithPacingAndRetry(
        async () => {
          const res = await generateText({
            model,
            prompt: buildTopicMintingPrompt(card.term, klps),
            output: Output.object({ schema: CardTopicProposalSchema }),
            maxRetries: 0,
          })
          return res.output
        },
        { pacer, clock: realClock },
      )
      return { proposal, model: combo.model, error: '' }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (err instanceof RunHaltedError && err.haltReason === 'daily_quota') {
        markExhausted(combo)
        progress(`     ${combo.id} out of daily quota; ${poolStatus(pool).available} left`)
      } else {
        progress(`     ${combo.model} failed: ${lastError.slice(0, 90)}`)
      }
    }
  }
  return { error: lastError || 'pool exhausted' }
}

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  // `--cards id,id,...` selects specific cards across sets (a spread run);
  // `--set` walks one set in position order. Never the whole corpus.
  const cardIds = (opt(args, '--cards') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  // `--replay <dual.json>` re-runs the reconciler and the judge over the raw
  // proposals a previous --dual run stored, minting nothing. Same inputs, new
  // rules — the comparison stays apples to apples, and it costs only judge
  // calls, which matters when the Gemini daily cap is already spent.
  const replay = opt(args, '--replay')
  if (replay) {
    const prev = JSON.parse(readFileSync(replay, 'utf8')) as { results: DualResult[] }
    const cards: ProbeCard[] = prev.results.map((r) => ({ id: r.id, term: r.term, setTitle: r.setTitle, klps: r.klps }))
    const stored = new Map(prev.results.map((r) => [r.id, r]))
    await runDual(cards, opt(args, '--json'), stored)
    return
  }
  if (!setId && cardIds.length === 0) {
    console.error('[probe-topic-minting] --set <setId> or --cards <id,...> is required. This never walks the corpus.')
    process.exit(1)
  }
  const limit = Number(opt(args, '--limit') ?? '12')
  // `--skip` makes a killed run resumable without re-spending quota on cards
  // already proposed. A 30-card run is ~20 minutes of wall clock and this probe
  // has been stopped mid-run once already; losing 3 completed cards to a kill is
  // pure waste against a 20-per-day-per-model cap.
  const skip = Number(opt(args, '--skip') ?? '0')

  const rows = cardIds.length
    ? await prisma.card.findMany({ where: { id: { in: cardIds }, klps: { some: { supersededAt: null } } }, select: cardSelect })
    : await prisma.card.findMany({
        where: { setId: setId!, klps: { some: { supersededAt: null } } },
        orderBy: { position: 'asc' },
        skip,
        take: limit,
        select: cardSelect,
      })
  // Preserve the caller's order for --cards.
  const ordered = cardIds.length ? cardIds.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r) : rows
  const cards: ProbeCard[] = ordered.map((r) => ({ id: r.id, term: r.term, setTitle: r.set.title, klps: r.klps }))
  if (cards.length === 0) {
    console.error(`[probe-topic-minting] no cards with live KLPs matched`)
    process.exit(1)
  }

  if (flagPresent(args, '--dual')) {
    await runDual(cards, opt(args, '--json'))
    return
  }

  const pool = readDirectPool()
  const status = poolStatus(pool)
  if (status.total === 0) {
    console.error('[probe-topic-minting] empty pool — needs GOOGLE_API_KEYS and KLP_DIRECT_MODELS')
    process.exit(1)
  }
  console.log(
    `[probe-topic-minting] DRY RUN — writes nothing. ${cards.length} card(s), ` +
      `pool of ${status.total} key x model combo(s).\n`,
  )

  const pacer = new Pacer(rpmToIntervalMs(DEFAULT_RPM), realClock)
  const results: { term: string; model: string; proposal: CardTopicProposal }[] = []
  const failures: { term: string; error: string }[] = []

  const jsonOut = opt(args, '--json')
  /**
   * Written after EVERY card, not once at the end.
   *
   * The end-of-run write lost three completed cards to a kill, and every one of
   * them cost a request against a 20-per-day-per-model cap. The file is a few
   * KB; rewriting it per card is free next to re-earning its contents.
   */
  const flush = () => {
    if (!jsonOut) return
    writeFileSync(jsonOut, JSON.stringify({ setId, skip, results, failures }, null, 2))
  }

  let cardNo = 0
  for (const card of cards) {
    progress(`[${++cardNo}/${cards.length}] ${card.term.slice(0, 56)}`)
    const klps = card.klps.map((k, i) => ({ ref: i, text: k.text, kind: k.kind }))
    const minted = await mintCard(pool, card, pacer)
    const proposal = minted.proposal
    const combo = minted.model ? { model: minted.model } : undefined

    if (!proposal || !combo) {
      failures.push({ term: card.term, error: minted.error })
      flush()
      console.log(`  FAILED  "${card.term.slice(0, 60)}" — ${minted.error.slice(0, 120)}`)
      continue
    }

    results.push({ term: card.term, model: combo.model, proposal })
    flush()
    progress(
      `     ok — ${proposal.parent}: ${proposal.leaves.map((l) => l.name).join(', ') || '(no leaves)'}` +
        (proposal.relations.length ? ` [+${proposal.relations.length} rel]` : ''),
    )
    const covered = new Set([
      ...proposal.leaves.flatMap((l) => l.klpRefs),
      ...proposal.relations.map((r) => r.klpRef),
    ])
    const missing = klps.filter((k) => !covered.has(k.ref)).length
    console.log(`── "${card.term.slice(0, 64)}"   [${combo.model}]`)
    console.log(`   parent: ${proposal.parent}`)
    for (const leaf of proposal.leaves) {
      console.log(`     • ${leaf.name}  (${leaf.klpRefs.length} KLP${leaf.klpRefs.length === 1 ? '' : 's'})`)
    }
    for (const rel of proposal.relations) {
      console.log(`     → ${rel.from} --${rel.type}--> ${rel.to}`)
    }
    if (proposal.contexts.length > 0) {
      const uniq = [...new Set(proposal.contexts.map((c) => c.concept))]
      console.log(`   contexts: ${uniq.join(', ')}`)
    }
    if (missing > 0) console.log(`   ⚠ RULE 6 VIOLATION: ${missing} KLP(s) uncovered`)
    console.log()
  }

  // ---- Aggregate. These are the numbers the run exists to produce. ----
  console.log('='.repeat(72))
  const allLeaves = results.flatMap((r) => r.proposal.leaves)
  const leafNames = allLeaves.map((l) => l.name.toLowerCase())
  const parents = results.map((r) => r.proposal.parent.toLowerCase())
  const contexts = results.flatMap((r) => r.proposal.contexts.map((c) => c.concept.toLowerCase()))
  const klpsPerLeaf = allLeaves.map((l) => l.klpRefs.length)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  console.log(`cards proposed: ${results.length}   failed: ${failures.length}`)
  console.log(`leaves minted: ${leafNames.length} (${new Set(leafNames).size} distinct)`)
  console.log(
    `KLPs per leaf: mean ${mean(klpsPerLeaf).toFixed(2)}  ` +
      `min ${Math.min(...klpsPerLeaf)}  max ${Math.max(...klpsPerLeaf)}`,
  )
  console.log(`leaves per card: mean ${mean(results.map((r) => r.proposal.leaves.length)).toFixed(2)}`)
  // CONVERGENCE — the number this run exists to produce.
  //
  // KLPs-per-leaf was the wrong measure and run 1 proved it: KLPs are already
  // the unit of independent failure, so "one leaf per failable thing" resolves
  // to one leaf per KLP. A leaf earns its place by being reached from SEVERAL
  // DIFFERENT CARDS.
  //
  // Read it as an UPPER BOUND on non-convergence: exact-string matching, run
  // BEFORE any reconciliation, so `working capital adjustments` and `operating
  // working capital adjustments` count as two different concepts.
  const cardsPerLeaf = new Map<string, Set<string>>()
  for (const r of results) {
    for (const l of r.proposal.leaves) {
      const k = l.name.toLowerCase()
      const set = cardsPerLeaf.get(k) ?? new Set<string>()
      set.add(r.term)
      cardsPerLeaf.set(k, set)
    }
  }
  const shared = [...cardsPerLeaf.entries()].filter(([, c]) => c.size >= 2)
  console.log(
    `\nCONVERGENCE: ${new Set(leafNames).size} distinct / ${leafNames.length} total = ` +
      `${(new Set(leafNames).size / Math.max(1, leafNames.length)).toFixed(2)} (1.00 = none)`,
  )
  console.log(`  leaves reached from >=2 cards: ${shared.length}`)
  for (const [n, c] of shared.sort((a, b) => b[1].size - a[1].size).slice(0, 12)) {
    console.log(`    ${c.size}x  ${n}`)
  }

  // CROSS-CARD JOIN RATE — whether rule 7's edges actually connect the map.
  // An endpoint no other card minted is a dead end. Run 2 scored 9%, and the
  // dangling names were the CANONICAL concepts (`retained earnings`,
  // `operating cash flow`, `net change in cash`): the edges knew the vocabulary
  // the leaves failed to use. Printing them by name is the point — they are the
  // candidate node list for a reconciliation pass.
  const allRelations = results.flatMap((r) =>
    r.proposal.relations.map((rel) => ({ ...rel, term: r.term })),
  )
  const conceptOwners = new Map<string, Set<string>>()
  for (const r of results) {
    for (const nm of [
      ...r.proposal.leaves.map((l) => l.name),
      ...r.proposal.contexts.map((c) => c.concept),
    ]) {
      const k = nm.toLowerCase()
      const set = conceptOwners.get(k) ?? new Set<string>()
      set.add(r.term)
      conceptOwners.set(k, set)
    }
  }
  let joined = 0
  let dangling = 0
  const danglingCount = new Map<string, number>()
  for (const rel of allRelations) {
    for (const end of [rel.from, rel.to]) {
      const owners = conceptOwners.get(end.toLowerCase())
      if (owners && [...owners].some((t) => t !== rel.term)) joined++
      else {
        dangling++
        danglingCount.set(end.toLowerCase(), (danglingCount.get(end.toLowerCase()) ?? 0) + 1)
      }
    }
  }
  const endpoints = joined + dangling
  console.log(`\nRELATIONS: ${allRelations.length} edge(s) across ${results.length} card(s)`)
  console.log(
    `  cross-card join rate: ${joined}/${endpoints} = ` +
      `${endpoints ? Math.round((100 * joined) / endpoints) : 0}%`,
  )
  const topDangling = [...danglingCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  if (topDangling.length > 0) {
    console.log(
      `  unmatched endpoints (CANDIDATE NODES): ` +
        `${topDangling.map(([n, c]) => `${n}(${c})`).join(' | ')}`,
    )
  }
  const relTypeCounts = allRelations.reduce<Record<string, number>>(
    (a, r) => ((a[r.type] = (a[r.type] ?? 0) + 1), a),
    {},
  )
  console.log(
    `  by type: ${Object.entries(relTypeCounts).map(([t, c]) => `${t}:${c}`).join(' ') || '(none)'}`,
  )
  console.log(`\nparents (${new Set(parents).size} distinct): ${[...new Set(parents)].join(' | ')}`)
  console.log(`\ncontexts (${new Set(contexts).size} distinct): ${[...new Set(contexts)].join(' | ')}`)

  // RULE 3/4 self-check, in TypeScript — the same discipline as computing
  // separation in TS rather than asking the model how it did.
  const CONTAINERS = [
    'income statement',
    'cash flow statement',
    'balance sheet',
    'leverage',
    'financial metrics',
    'accounting',
    'technicals',
    'valuation',
    'statements',
    'finance',
  ]
  const badLeaves = leafNames.filter((n) => CONTAINERS.includes(n))
  const badContexts = contexts.filter((n) => CONTAINERS.includes(n))
  console.log(
    `\nRULE 3 (no container as a leaf): ${badLeaves.length === 0 ? 'PASS' : `FAIL — ${[...new Set(badLeaves)].join(', ')}`}`,
  )
  console.log(
    `RULE 4 (contexts at mechanism grain): ${badContexts.length === 0 ? 'PASS' : `FAIL — ${[...new Set(badContexts)].join(', ')}`}`,
  )

  // PER-MODEL rule compliance. Run 2 mixed three models and the violations were
  // NOT evenly spread: gemini-3.1-flash-lite produced EVERY container leaf,
  // while -3.5-flash and -3.6-flash produced none. Rule compliance is a model
  // property, so an aggregate PASS/FAIL hides which model can be trusted to
  // author topics — which is the decision this probe exists to inform.
  const byModel = new Map<string, { cards: number; leaves: number; bad: number; rels: number }>()
  for (const r of results) {
    const e = byModel.get(r.model) ?? { cards: 0, leaves: 0, bad: 0, rels: 0 }
    e.cards++
    e.rels += r.proposal.relations.length
    for (const l of r.proposal.leaves) {
      e.leaves++
      if (CONTAINERS.includes(l.name.toLowerCase())) e.bad++
    }
    byModel.set(r.model, e)
  }
  console.log(`\nPER-MODEL:`)
  for (const [m, v] of [...byModel.entries()].sort((a, b) => b[1].cards - a[1].cards)) {
    console.log(
      `  ${m.padEnd(24)} cards=${String(v.cards).padStart(2)}  leaves=${String(v.leaves).padStart(3)}` +
        `  container-leaves=${String(v.bad).padStart(2)}  rels=${String(v.rels).padStart(2)}`,
    )
  }

  // How much of this vocabulary is genuinely new? The point of minting blind.
  const existing = new Set(
    (await prisma.klt.findMany({ select: { name: true } })).map((k) => k.name.toLowerCase()),
  )
  const novel = [...new Set(leafNames)].filter((n) => !existing.has(n))
  console.log(
    `\nnovel leaf names (not in the ${existing.size} existing concepts): ` +
      `${novel.length}/${new Set(leafNames).size}`,
  )
  console.log(`  ${novel.join(' | ')}`)

  if (jsonOut) console.log(`
wrote ${jsonOut}`)
}

// ---------------------------------------------------------------------------
// --dual: DeepSeek + Gemini, reconciled in TypeScript, judged by Qwen
// ---------------------------------------------------------------------------

// The pair and the judge. `MINT_B_MODEL` lets a run put the Gemini side on a
// different model than the authoring writer is using the same day — the two
// jobs otherwise compete for one 20/day/key bucket.
const DUAL_A = { provider: 'deepseek', model: 'deepseek-v4-flash' }
const DUAL_B = { provider: 'google', model: process.env.MINT_B_MODEL?.trim() || 'gemini-3.6-flash' }
const JUDGE = { provider: 'qwen', model: 'qwen3.7-flash' }
/** Recorded in the JSON so the A/B slot assignment can be reproduced. */
const JUDGE_SEED = 20260911

function poolFor(provider: string, model: string): DirectCombo[] {
  return readDirectPool({ ...process.env, KLP_DIRECT_PROVIDER: provider, KLP_DIRECT_MODELS: model })
}

type Shape = 'leaf' | 'edge' | 'none'

function shapesOf(p: CardTopicProposal, n: number): Shape[] {
  return Array.from({ length: n }, (_, i) =>
    p.relations.some((r) => r.klpRef === i) ? 'edge' : p.leaves.some((l) => l.klpRefs.includes(i)) ? 'leaf' : 'none',
  )
}

function mergedShapes(m: MergedProposal, n: number): Shape[] {
  return Array.from({ length: n }, (_, i) =>
    m.relations.some((r) => r.klpRef === i) ? 'edge' : m.leaves.some((l) => l.klpRefs.includes(i)) ? 'leaf' : 'none',
  )
}

function kindConsistent(shapes: Shape[], kinds: string[]): { ok: number; total: number } {
  let ok = 0
  let total = 0
  shapes.forEach((sh, i) => {
    if (sh === 'none') return
    total++
    const prior = EXPECTED_SHAPE[kinds[i] as keyof typeof EXPECTED_SHAPE] ?? 'either'
    if (prior === 'either' || prior === sh) ok++
  })
  return { ok, total }
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

interface DualResult {
  id: string
  term: string
  setTitle: string
  klps: { text: string; kind: string }[]
  deepseek?: { model: string; proposal: CardTopicProposal }
  gemini?: { model: string; proposal: CardTopicProposal }
  merged?: MergedProposal
  conflictsSent: MergedProposal['conflicts']
  verdicts: ReturnType<typeof toVerdicts>
  judgeCalls: number
  judgeError?: string
  error?: string
}

async function runDual(
  cards: ProbeCard[],
  jsonOut: string | undefined,
  stored?: Map<string, DualResult>,
): Promise<void> {
  const poolA = poolFor(DUAL_A.provider, DUAL_A.model)
  const poolB = poolFor(DUAL_B.provider, DUAL_B.model)
  const poolJ = poolFor(JUDGE.provider, JUDGE.model)
  const pacerA = new Pacer(rpmToIntervalMs(DEFAULT_RPM), realClock)
  const pacerB = new Pacer(rpmToIntervalMs(DEFAULT_RPM), realClock)
  const pacerJ = new Pacer(rpmToIntervalMs(DEFAULT_RPM), realClock)
  console.log(
    `[probe-topic-minting] DUAL DRY RUN — writes nothing. ${cards.length} card(s). ` +
      `A=${DUAL_A.model} B=${DUAL_B.model} judge=${JUDGE.model} seed=${JUDGE_SEED}\n`,
  )
  const results: DualResult[] = []
  const runVocabulary = new Set<string>()
  const flush = () => {
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ a: DUAL_A, b: DUAL_B, judge: JUDGE, seed: JUDGE_SEED, results }, null, 2))
  }

  let cardNo = 0
  for (const card of cards) {
    progress(`[${++cardNo}/${cards.length}] ${card.term.slice(0, 56)}`)
    const prev = stored?.get(card.id)
    const [ra, rb] = prev
      ? [
          { proposal: prev.deepseek?.proposal, model: prev.deepseek?.model, error: prev.error ?? 'not minted' },
          { proposal: prev.gemini?.proposal, model: prev.gemini?.model, error: prev.error ?? 'not minted' },
        ]
      : await Promise.all([mintCard(poolA, card, pacerA), mintCard(poolB, card, pacerB)])
    const rec: DualResult = {
      id: card.id,
      term: card.term,
      setTitle: card.setTitle,
      klps: card.klps,
      conflictsSent: [],
      verdicts: [],
      judgeCalls: 0,
    }
    if (ra.proposal && ra.model) rec.deepseek = { model: ra.model, proposal: ra.proposal }
    if (rb.proposal && rb.model) rec.gemini = { model: rb.model, proposal: rb.proposal }
    if (!rec.deepseek || !rec.gemini) {
      rec.error = `${rec.deepseek ? '' : `A failed: ${ra.error.slice(0, 100)} `}${rec.gemini ? '' : `B failed: ${rb.error.slice(0, 100)}`}`
      results.push(rec)
      flush()
      console.log(`  FAILED  "${card.term.slice(0, 60)}" — ${rec.error}`)
      continue
    }

    const merged = reconcileProposals({ klps: card.klps, a: rec.deepseek.proposal, b: rec.gemini.proposal, runVocabulary })
    rec.conflictsSent = merged.conflicts
    let final = merged
    if (merged.conflicts.length > 0) {
      const items = buildJudgeItems(merged.conflicts, card.klps.map((k) => k.text), JUDGE_SEED + cardNo)
      const combo = nextCombo(poolJ)
      if (combo) {
        markTried(combo, new Date())
        rec.judgeCalls = 1
        try {
          const parsed = await callWithPacingAndRetry(
            async () => {
              const res = await generateText({
                model: resolveLanguageModel(comboResolveInput(combo)),
                prompt: buildJudgePrompt(items),
                output: Output.object({ schema: JudgeVerdictSchema }),
                maxRetries: 0,
              })
              return res.output
            },
            { pacer: pacerJ, clock: realClock },
          )
          rec.verdicts = toVerdicts(items, parsed)
        } catch (err) {
          rec.judgeError = err instanceof Error ? err.message : String(err)
          progress(`     judge failed: ${rec.judgeError.slice(0, 90)}`)
        }
      } else rec.judgeError = 'judge pool empty'
      final = applyVerdicts(merged, rec.verdicts, card.klps.map((k) => k.text))
    }
    rec.merged = final
    for (const l of final.leaves) runVocabulary.add(normalizeName(l.name))
    for (const e of final.relations) runVocabulary.add(normalizeName(e.from)), runVocabulary.add(normalizeName(e.to))
    results.push(rec)
    flush()

    progress(
      `     ok — ${final.parent}: ${final.leaves.map((l) => l.name).join(', ') || '(no leaves)'}` +
        (final.relations.length ? ` [+${final.relations.length} rel]` : '') +
        (rec.conflictsSent.length ? ` judged ${rec.conflictsSent.length}` : ''),
    )
    console.log(`── "${card.term.slice(0, 64)}"   [${card.setTitle}]`)
    console.log(`   parent: ${final.parent}  (${final.parentReason})`)
    for (const l of final.leaves) console.log(`     • ${l.name}  ← KLP ${l.klpRefs.join(',')}  [${l.reason}]${l.container ? (l.containerAllowed ? '  (statement, definition KLP)' : '  ⚠ container') : ''}`)
    for (const r of final.relations) console.log(`     → ${r.from} --${r.type}--> ${r.to}  ← KLP ${r.klpRef}  [${r.reason}]${r.containerEndpoint ? '  ⚠ container endpoint' : ''}`)
    if (final.contexts.length) console.log(`   contexts: ${final.contexts.map((c) => `${c.concept} [${c.reason}]`).join('; ')}`)
    for (const n of final.notes) console.log(`   · ${n}`)
    console.log()
  }

  // ---- Report: merged vs each raw side ----
  console.log('='.repeat(72))
  const ok = results.filter((r) => r.merged && r.deepseek && r.gemini)
  console.log(`cards merged: ${ok.length}   failed: ${results.length - ok.length}`)
  interface SideView { shapes: Shape[]; names: string[]; contexts: number; selfDups: number }
  const sides: { label: string; get: (r: DualResult) => SideView }[] = [
    {
      label: DUAL_A.model,
      get: (r) => ({
        shapes: shapesOf(r.deepseek!.proposal, r.klps.length),
        names: r.deepseek!.proposal.leaves.map((l) => l.name),
        contexts: r.deepseek!.proposal.contexts.length,
        selfDups: r.merged!.notes.filter((n) => n.includes('purge:self-dup side a')).length,
      }),
    },
    {
      label: DUAL_B.model,
      get: (r) => ({
        shapes: shapesOf(r.gemini!.proposal, r.klps.length),
        names: r.gemini!.proposal.leaves.map((l) => l.name),
        contexts: r.gemini!.proposal.contexts.length,
        selfDups: r.merged!.notes.filter((n) => n.includes('purge:self-dup side b')).length,
      }),
    },
    {
      label: 'MERGED',
      get: (r) => ({
        shapes: mergedShapes(r.merged!, r.klps.length),
        names: r.merged!.leaves.map((l) => l.name),
        contexts: r.merged!.contexts.length,
        selfDups: 0,
      }),
    },
  ]
  console.log(`\n${'side'.padEnd(20)} kind-consistent      leaves  edges  contexts  self-dups  mean-name-words  container-leaves`)
  for (const side of sides) {
    let kok = 0, ktot = 0, leaves = 0, edges = 0, contexts = 0, selfDups = 0, wsum = 0, containers = 0, nNames = 0
    for (const r of ok) {
      const v = side.get(r)
      const kc = kindConsistent(v.shapes, r.klps.map((k) => k.kind))
      kok += kc.ok; ktot += kc.total
      leaves += v.shapes.filter((x) => x === 'leaf').length
      edges += v.shapes.filter((x) => x === 'edge').length
      contexts += v.contexts
      selfDups += v.selfDups
      nNames += v.names.length
      for (const n of v.names) { wsum += words(n); if (isContainerName(n)) containers++ }
      if (side.label === 'MERGED') containers -= r.merged!.leaves.filter((l) => l.containerAllowed).length
    }
    const pct = ktot ? Math.round((100 * kok) / ktot) : 0
    console.log(
      `${side.label.padEnd(20)} ${`${pct}% (${kok}/${ktot})`.padEnd(20)} ${String(leaves).padStart(4)}   ${String(edges).padStart(4)}   ${String(contexts).padStart(6)}   ${String(selfDups).padStart(7)}   ${(nNames ? wsum / nNames : 0).toFixed(2).padStart(13)}   ${String(containers).padStart(8)}`,
    )
  }
  const judgeCalls = results.reduce((a, r) => a + r.judgeCalls, 0)
  const sent = results.reduce((a, r) => a + r.conflictsSent.length, 0)
  console.log(`\njudge calls: ${judgeCalls} over ${results.length} cards (${(judgeCalls / Math.max(1, results.length)).toFixed(2)}/card); items sent: ${sent}; judge failures: ${results.filter((r) => r.judgeError).length}`)
  const reasons = new Map<string, number>()
  for (const r of ok) for (const x of [...r.merged!.leaves, ...r.merged!.relations, ...r.merged!.contexts]) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1)
  console.log(`reasons: ${[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`)
  if (jsonOut) console.log(`\nwrote ${jsonOut}`)
}

main().finally(() => process.exit(0))
