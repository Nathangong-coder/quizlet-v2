/**
 * The whole-card minting loop over a set (2026-09-15). DRY: nothing is
 * written to the database; the outcome per card — kept proposal, settings,
 * enforcement, every round — goes to --json, and the run prints the
 * settings distribution so the bars can be set from it.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/mint-loop.ts --set <setId> [--limit N] [--skip N] [--cards id,id] --json out.json
 *
 * DeepSeek at temperature 0 for every call (mint, assign, revise);
 * KLP_DIRECT_PROVIDER / KLP_DIRECT_MODELS override the model.
 */
import { generateText, Output, NoObjectGeneratedError } from 'ai'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { readDirectPool, comboResolveInput } from '../src/lib/klp/direct-pool'
import { CardTopicProposalV2Schema } from '../src/lib/klp/topic-minting-v2'
import { RoundTripSchema } from '../src/lib/ai/prompts/roundtrip-assign'
import { mintCardLoop, TOPIC_BARS, type TopicGenerator, type TopicLoopOutcome } from '../src/lib/klp/topic-loop'
import type { KlpLink } from '../src/lib/klp/topic-enforcement'
import { TokenMeter } from '../src/lib/klp/token-meter'
import { Pacer, rpmToIntervalMs, realClock } from '../src/lib/klp/authoring-pacing'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const setId = opt('--set')
  const out = opt('--json')
  const limit = Number(opt('--limit') ?? '1000')
  const skip = Number(opt('--skip') ?? '0')
  const only = (opt('--cards') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const rpm = Number(opt('--rpm') ?? '40')
  if (!setId || !out) throw new Error('--set and --json are required')

  const pool = readDirectPool({ ...process.env, KLP_DIRECT_PROVIDER: process.env.KLP_DIRECT_PROVIDER ?? 'deepseek', KLP_DIRECT_MODELS: process.env.KLP_DIRECT_MODELS ?? 'deepseek-flash' } as NodeJS.ProcessEnv)
  const combo = pool[0]
  const model = resolveLanguageModel(comboResolveInput(combo))
  const meter = new TokenMeter()
  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock)

  const call = async <T,>(step: string, prompt: string, schema: Parameters<typeof Output.object>[0]['schema']): Promise<T> => {
    await pacer.waitTurn()
    const attempt = () => generateText({ model, prompt, output: Output.object({ schema }), maxRetries: 0, temperature: 0 })
    let res: Awaited<ReturnType<typeof attempt>>
    try {
      res = await attempt()
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) throw err
      await pacer.waitTurn()
      res = await attempt()
    }
    meter.add(step, combo.model, { inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens, reasoningTokens: res.usage?.outputTokenDetails?.reasoningTokens, cachedTokens: res.usage?.inputTokenDetails?.cacheReadTokens })
    return res.output as T
  }
  const gen: TopicGenerator = {
    mint: (p) => call('mint', p, CardTopicProposalV2Schema),
    assign: (p) => call('roundtrip', p, RoundTripSchema),
    revise: (p) => call('revise', p, CardTopicProposalV2Schema),
  }

  const set = await prisma.set.findUnique({ where: { id: setId }, select: { title: true } })
  const rows = await prisma.card.findMany({
    where: { setId, ...(only.length ? { id: { in: only } } : {}), klps: { some: { supersededAt: null } } },
    orderBy: { position: 'asc' },
    skip: only.length ? 0 : skip,
    take: only.length ? undefined : limit,
    select: { id: true, term: true, klps: { where: { supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, text: true, kind: true, relationsFrom: { select: { toKlpId: true, type: true } } } } },
  })
  // resumable: keep what a previous run of this file already did
  const prior: { outcomes: (TopicLoopOutcome & { cardId: string })[] } = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { outcomes: [] }
  const done = new Set(prior.outcomes.map((o) => o.cardId))
  const outcomes = [...prior.outcomes]
  const failures: { cardId: string; term: string; error: string }[] = []
  const flush = () => writeFileSync(out, JSON.stringify({ setId, setTitle: set?.title, model: combo.model, bars: TOPIC_BARS, outcomes, failures, tokens: meter.toJSON() }, null, 2))

  let n = 0
  for (const c of rows) {
    n += 1
    if (done.has(c.id)) continue
    const index = new Map(c.klps.map((k, i) => [k.id, i]))
    const links: KlpLink[] = []
    c.klps.forEach((k, i) => { for (const r of k.relationsFrom) { const to = index.get(r.toKlpId); if (to !== undefined) links.push({ from: i, to, type: r.type }) } })
    try {
      const o = await mintCardLoop({ term: c.term, setTitle: set?.title ?? '', klps: c.klps.map((k) => ({ text: k.text, kind: k.kind })), links }, gen)
      outcomes.push({ ...o, cardId: c.id })
      const s = o.settings
      console.log(`[${n}/${rows.length}] ${c.term.slice(0, 60)} — ${o.status}${o.flags.length ? ` (${o.flags.join(', ')})` : ''} | rounds ${o.rounds.length} kept ${o.keptRound} | overall ${s.overall.toFixed(2)} cov ${s.coverage.toFixed(2)} anch ${s.anchored.toFixed(2)} caus ${s.causalEdges.toFixed(2)} tgt ${s.causalTargets.toFixed(2)} brev ${s.brevity.toFixed(2)} dist ${s.distinctness.toFixed(2)} rt ${s.roundTrip === undefined ? '—' : s.roundTrip.toFixed(2)} enf ${o.enforcement.klpKltEnforcement.toFixed(2)} | anchor "${o.anchor}"`)
    } catch (err) {
      failures.push({ cardId: c.id, term: c.term, error: err instanceof Error ? err.message : String(err) })
      console.log(`[${n}/${rows.length}] ${c.term.slice(0, 60)} — FAILED ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`)
    }
    flush()
  }

  const keys = ['overall', 'coverage', 'anchored', 'causalEdges', 'causalTargets', 'brevity', 'vocabulary', 'noContainers', 'distinctness', 'roundTrip'] as const
  const dist = (k: (typeof keys)[number]) => {
    const v = outcomes.map((o) => (o.settings as unknown as Record<string, number | undefined>)[k]).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)
    if (!v.length) return '—'
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))].toFixed(2)
    return `mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}  p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}`
  }
  console.log(`\n[mint-loop] ${outcomes.length} cards, ${failures.length} failed; clear ${outcomes.filter((o) => o.status === 'clear').length}, flagged ${outcomes.filter((o) => o.status === 'flagged').length}; rounds/card ${(outcomes.reduce((a, o) => a + o.rounds.length, 0) / Math.max(1, outcomes.length)).toFixed(2)}; veto kept an earlier round on ${outcomes.filter((o) => o.keptRound < o.rounds.length - 1).length}`)
  for (const k of keys) console.log(`  ${k.padEnd(14)} ${dist(k)}`)
  const flagCounts: Record<string, number> = {}
  for (const o of outcomes) for (const fl of o.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1
  console.log(`  flags: ${Object.entries(flagCounts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
  console.log('\n' + meter.format(outcomes.length))
  await prisma.$disconnect()
}
main()
