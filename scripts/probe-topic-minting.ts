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
import { writeFileSync } from 'node:fs'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel} from '../src/lib/ai/providers'
// The SAME edge vocabulary the KLP-level relate call uses. Defined once in
// `relations.ts` and consumed here so the concept graph and the key-point graph
// cannot drift into two different sets of edge types.
import { RELATABLE_TYPES } from '../src/lib/klp/relations'
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
 * The proposal for ONE card.
 *
 * `klpRefs` are indices into the card's KLP list as sent. Cuids are never shown
 * to the model, per the same rule the rest of the pipeline follows.
 */
const CardTopicProposalSchema = z.object({
  parent: z
    .string()
    .describe('The umbrella concept this card sits under. 1-4 words, lowercase.'),
  leaves: z
    .array(
      z.object({
        name: z.string().describe('A specific, independently-failable concept. 1-5 words.'),
        klpRefs: z.array(z.number().int()).min(1),
      }),
    )
    .min(0)
    .max(6),
  contexts: z
    .array(
      z.object({
        klpRef: z.number().int(),
        concept: z
          .string()
          .describe('A MECHANISM this point also touches, e.g. "non-cash adjustments".'),
      }),
    )
    .max(10),
  /**
   * KLPs whose content IS a link between two concepts, emitted as edges rather
   * than leaves.
   *
   * The first run minted leaves called `net income retained earnings linkage`
   * and `investing activities long-term asset link` — relations phrased as
   * nouns. A phrase like that can never match a concept another card mints, so
   * it is a dead-end node AND a lost edge.
   *
   * `from`/`to` are therefore required to be STANDALONE concept names, spelled
   * exactly the way a leaf would be. That is the whole mechanism by which the
   * graph crosses card boundaries: card A mints `retained earnings` as a leaf,
   * card B emits `net income -> retained earnings` as an edge, and the two meet
   * on the name. Describe the link in a phrase instead and nothing joins up.
   */
  relations: z
    .array(
      z.object({
        klpRef: z.number().int(),
        from: z.string().describe('A standalone concept name, exactly as a leaf would be named.'),
        to: z.string().describe('A standalone concept name, exactly as a leaf would be named.'),
        type: z.enum(RELATABLE_TYPES),
      }),
    )
    .max(8),
})

type CardTopicProposal = z.infer<typeof CardTopicProposalSchema>

function buildPrompt(term: string, klps: { ref: number; text: string; kind: string }[]): string {
  const lines = klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n')
  return `You are building the topic hierarchy for a finance study library.

Below is ONE flashcard and every Key Learning Point (KLP) it teaches. A KLP is one
specific claim a learner must be able to state, and each one can be graded right or
wrong on its own.

Card: ${term}

KLPs:
${lines}

Produce the small piece of topic hierarchy these points belong to.

RULE 1 — ONE PARENT, SPECIFIC CHILDREN.
Give a "parent" concept the card sits under, then "leaves" beneath it. The parent is
allowed to be somewhat general; the leaves must not be.

RULE 2 — THE FAILURE-GRAIN RULE. THIS IS THE MOST IMPORTANT ONE.
A learner must be able to fail exactly one leaf at a time. If a learner could get one
claim right and another wrong, those two claims belong to DIFFERENT leaves.
  Card about DSCR and FCCR ->
    parent: "debt coverage ratios"
    leaves: "debt service coverage ratio", "fixed charge coverage ratio"
  NOT one merged leaf called "debt service coverage" — a learner can know DSCR and not
  know FCCR, and a merged leaf cannot record that.
Conversely, do NOT split a single indivisible claim into two leaves to look thorough.

RULE 3 — NAME THE SUBJECT, NOT THE SETTING.
Many points say what happens to a financial statement. The statement is WHERE it
happens, not what the point is about. Never use a bare statement name as a leaf.
  "On the Income Statement, a $10 SBC increase reduces Net Income by $6"
     subject leaf -> "stock-based compensation expense"
  "Share repurchases reduce cash in the financing section"
     subject leaf -> "share repurchases"

RULE 4 — SETTINGS ARE STILL RECORDED, AT MECHANISM GRAIN.
For each KLP that genuinely operates inside a statement, add a "contexts" entry naming
the MECHANISM, never the statement.
  GOOD contexts: "non-cash adjustments", "financing cash flow", "working capital changes",
                 "operating cash flow", "deferred taxes", "equity rollforward"
  BAD contexts:  "income statement", "cash flow statement", "balance sheet" — too broad,
                 these are containers and the app already knows the containment.
A KLP with no meaningful mechanism gets no context entry. Do not invent one.

RULE 5 — MINT FREELY. PREFER SPECIFIC.
There is no list of approved names. Invent the precise concept. Never reach for a broad
container like "leverage", "financial metrics", "accounting", "technicals" or
"valuation" as a LEAF — those are acceptable only as a parent, and usually not even
then.

RULE 6 — COVER EVERY KLP EXACTLY ONCE, as either a leaf member or a relation.
Every ref above appears in exactly one leaf's klpRefs OR in exactly one relation.

RULE 7 — A KLP THAT IS A LINK BECOMES A RELATION, NOT A LEAF.
Some points do not describe a thing; they describe how two things connect
("net income flows into retained earnings", "depreciation is added back to operating
cash flow"). Emit those as "relations", and do NOT invent a leaf for them.

  "Net income flows into retained earnings on the balance sheet"
     -> relation { from: "net income", to: "retained earnings", type: "precedes" }
     NOT a leaf called "net income retained earnings linkage"

BOTH ENDPOINTS MUST BE STANDALONE CONCEPT NAMES, spelled exactly as you would name a
leaf. This is the point of the rule: another card will mint "retained earnings" as its
own leaf, and the two must meet on the name so the map joins up across cards. A phrase
that describes the link instead of naming its ends connects to nothing.
  GOOD: from "depreciation", to "operating cash flow"
  BAD:  from "depreciation add-back mechanic", to "cash flow impact"

Edge types, use the closest one:
  causes          — A brings B about
  requires        — B cannot be computed or stated without A
  precedes        — A comes before B in a sequence or flows into it
  applies_within  — A operates inside B (depreciation applies_within operating cash flow)
  confused_with   — learners routinely mistake A for B

Prefer naming a WIDELY-REUSABLE concept at each end. "net income", "operating cash
flow", "retained earnings" are reusable; "the year-1 net income figure" is not.

Names are lowercase noun phrases, no articles, no trailing punctuation. Spell out an
abbreviation the first time it is the leaf name (write "fixed charge coverage ratio",
not "FCCR").`
}

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

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  if (!setId) {
    console.error('[probe-topic-minting] --set <setId> is required. This never walks the corpus.')
    process.exit(1)
  }
  const limit = Number(opt(args, '--limit') ?? '12')
  // `--skip` makes a killed run resumable without re-spending quota on cards
  // already proposed. A 30-card run is ~20 minutes of wall clock and this probe
  // has been stopped mid-run once already; losing 3 completed cards to a kill is
  // pure waste against a 20-per-day-per-model cap.
  const skip = Number(opt(args, '--skip') ?? '0')

  const cards = await prisma.card.findMany({
    where: { setId, klps: { some: { supersededAt: null } } },
    orderBy: { position: 'asc' },
    skip,
    take: limit,
    select: {
      id: true,
      term: true,
      klps: {
        where: { supersededAt: null },
        orderBy: { index: 'asc' },
        select: { text: true, kind: true },
      },
    },
  })
  if (cards.length === 0) {
    console.error(`[probe-topic-minting] no cards with live KLPs in set ${setId}`)
    process.exit(1)
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
    let combo: DirectCombo | undefined
    let proposal: CardTopicProposal | undefined
    let lastError = ''
    // BOUNDED, and that bound is not optional. `nextCombo` is
    // `selectAttemptOrder(pool)[0]` — it returns the best AVAILABLE combo and
    // never returns undefined while any combo is enabled, so
    // `while ((combo = nextCombo(pool)))` is an INFINITE loop for every failure
    // that is not a daily-quota halt. The first version of this script had
    // exactly that bug and spun on card 1 for twelve minutes at full CPU,
    // hammering the provider. `author-klps` gets this right with
    // `MAX_COMBO_ATTEMPTS_PER_CARD`; this mirrors it.
    let attemptsLeft = MAX_COMBO_ATTEMPTS_PER_CARD

    while (attemptsLeft-- > 0 && (combo = nextCombo(pool))) {
      markTried(combo, new Date())
      try {
        const model = resolveLanguageModel(comboResolveInput(combo))
        proposal = await callWithPacingAndRetry(
          async () => {
            const res = await generateText({
              model,
              prompt: buildPrompt(card.term, klps),
              output: Output.object({ schema: CardTopicProposalSchema }),
              // maxRetries: 0 — the pacing layer owns retry; two retry
              // authorities multiply rather than compose, and against a
              // 20-per-DAY cap that burns the budget on a wall.
              maxRetries: 0,
            })
            return res.output
          },
          { pacer, clock: realClock },
        )
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        // Only a DAILY-quota halt retires the combo for the run. Retiring on
        // any error would burn the whole pool on one badly-behaved card.
        if (err instanceof RunHaltedError && err.haltReason === 'daily_quota') {
          markExhausted(combo)
          progress(`     ${combo.id} out of daily quota; ${poolStatus(pool).available} left`)
        } else {
          progress(`     ${combo.model} failed: ${lastError.slice(0, 90)}`)
        }
      }
    }

    if (!proposal || !combo) {
      failures.push({ term: card.term, error: lastError || 'pool exhausted' })
      flush()
      console.log(`  FAILED  "${card.term.slice(0, 60)}" — ${lastError.slice(0, 120)}`)
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

main().finally(() => process.exit(0))
