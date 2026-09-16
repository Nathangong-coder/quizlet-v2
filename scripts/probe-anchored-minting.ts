/**
 * Anchored minting probe (2026-09-15): mint the same cards under prompt v1
 * and prompt v2 (DeepSeek, temperature 0), score both with the KLT settings
 * and the enforcement statistic, and write everything to --json for the
 * trace artifact. Dry — nothing is written to the database.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/probe-anchored-minting.ts --cards id,id,id --json out.json
 */
import { generateText, Output } from 'ai'
import { writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { readDirectPool, comboResolveInput } from '../src/lib/klp/direct-pool'
import { buildTopicMintingPrompt, CardTopicProposalSchema, type CardTopicProposal } from '../src/lib/klp/topic-minting'
import { buildTopicMintingPromptV2, CardTopicProposalV2Schema, toV1, type CardTopicProposalV2 } from '../src/lib/klp/topic-minting-v2'
import { enforcementReport, renderLinks, type KlpLink } from '../src/lib/klp/topic-enforcement'
import { kltSettings } from '../src/lib/klp/topic-settings'
import { TokenMeter } from '../src/lib/klp/token-meter'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const ids = (opt('--cards') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const out = opt('--json')
  if (ids.length === 0 || !out) throw new Error('--cards and --json are required')
  const pool = readDirectPool({ ...process.env, KLP_DIRECT_PROVIDER: process.env.KLP_DIRECT_PROVIDER ?? 'deepseek', KLP_DIRECT_MODELS: process.env.KLP_DIRECT_MODELS ?? 'deepseek-flash' } as NodeJS.ProcessEnv)
  const combo = pool[0]
  const model = resolveLanguageModel(comboResolveInput(combo))
  const meter = new TokenMeter()
  const temperature = 0

  const cards = await prisma.card.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      term: true,
      definition: true,
      set: { select: { title: true } },
      klps: { where: { supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, text: true, kind: true, role: true, relationsFrom: { select: { toKlpId: true, type: true } } } },
    },
  })
  const results: unknown[] = []
  for (const id of ids) {
    const c = cards.find((x) => x.id === id)
    if (!c) continue
    const index = new Map(c.klps.map((k, i) => [k.id, i]))
    const links: KlpLink[] = []
    c.klps.forEach((k, i) => { for (const r of k.relationsFrom) { const to = index.get(r.toKlpId); if (to !== undefined) links.push({ from: i, to, type: r.type }) } })
    const promptKlps = c.klps.map((k, i) => ({ ref: i, text: k.text, kind: k.kind }))
    const klps = c.klps.map((k) => ({ text: k.text, kind: k.kind, role: k.role }))
    console.log(`\n== ${c.term.slice(0, 70)} (${c.set.title}) — ${klps.length} KLPs, ${links.length} links`)

    const call = async <T,>(step: string, prompt: string, schema: Parameters<typeof Output.object>[0]['schema']) => {
      const res = await generateText({ model, prompt, output: Output.object({ schema }), maxRetries: 1, temperature })
      meter.add(step, combo.model, { inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens, reasoningTokens: res.usage?.outputTokenDetails?.reasoningTokens, cachedTokens: res.usage?.inputTokenDetails?.cacheReadTokens })
      return res.output as T
    }
    const v1 = await call<CardTopicProposal>('mint-v1', buildTopicMintingPrompt(c.term, promptKlps, renderLinks(links)), CardTopicProposalSchema)
    const v2 = await call<CardTopicProposalV2>('mint-v2', buildTopicMintingPromptV2(c.term, c.set.title, promptKlps, renderLinks(links)), CardTopicProposalV2Schema)
    const s1 = kltSettings({ klps, proposal: v1 })
    const s2 = kltSettings({ klps, proposal: v2 })
    const e1 = enforcementReport(klps, links, v1)
    const e2 = enforcementReport(klps, links, toV1(v2))
    console.log(`   v1: settings ${s1.overall.toFixed(2)} (coverage ${s1.coverage.toFixed(2)} anchored ${s1.anchored.toFixed(2)} causalEdges ${s1.causalEdges.toFixed(2)} targets ${s1.causalTargets.toFixed(2)} brevity ${s1.brevity.toFixed(2)} vocab ${s1.vocabulary.toFixed(2)} noContainers ${s1.noContainers.toFixed(2)}) enforcement ${e1.klpKltEnforcement.toFixed(2)}`)
    console.log(`   v2: settings ${s2.overall.toFixed(2)} (coverage ${s2.coverage.toFixed(2)} anchored ${s2.anchored.toFixed(2)} causalEdges ${s2.causalEdges.toFixed(2)} targets ${s2.causalTargets.toFixed(2)} brevity ${s2.brevity.toFixed(2)} vocab ${s2.vocabulary.toFixed(2)} noContainers ${s2.noContainers.toFixed(2)}) enforcement ${e2.klpKltEnforcement.toFixed(2)} | anchor "${v2.anchor}" under "${v2.domain}"`)
    results.push({ cardId: c.id, term: c.term, set: c.set.title, definition: c.definition, klps, links, v1: { proposal: v1, settings: s1, enforcement: e1 }, v2: { proposal: v2, settings: s2, enforcement: e2 } })
  }
  writeFileSync(out, JSON.stringify({ model: combo.model, results, tokens: meter.toJSON() }, null, 2))
  console.log('\n' + meter.format(ids.length))
  await prisma.$disconnect()
}
main()
