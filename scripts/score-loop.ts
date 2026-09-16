/**
 * Rescore minting-loop outcomes offline with the CURRENT settings code and
 * print the corpus distribution, so a measure can change without re-spending
 * calls (the proposals and the round-trip assignments are in the JSON).
 *
 *   npx tsx scripts/score-loop.ts --from loop-a.json,loop-b.json [--json dist.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { kltSettings, withRoundTrip, type KltSettingsReport } from '../src/lib/klp/topic-settings'
import { enforcementReport, type KlpLink } from '../src/lib/klp/topic-enforcement'
import { toV1, type CardTopicProposalV2 } from '../src/lib/klp/topic-minting-v2'
import { barsMissed, TOPIC_BARS } from '../src/lib/klp/topic-loop'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

type Loop = { setTitle?: string; outcomes: { cardId: string; term: string; proposal: CardTopicProposalV2; rounds: { proposal: CardTopicProposalV2; settings: KltSettingsReport }[]; keptRound: number; klps?: { text: string; kind: string }[] }[] }

function main() {
  const files = (opt('--from') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const corpus = JSON.parse(readFileSync(`${process.env.TEMP}/claude-quizlet/corpus-summary.json`, 'utf8')) as { set: string; perCard: { cardId: string; klps: { text: string; kind: string }[] }[] }[]
  const klpsOf = new Map(corpus.flatMap((s) => s.perCard.map((c) => [c.cardId, c.klps] as const)))
  const rows: { set: string; term: string; cardId: string; settings: KltSettingsReport; enforcement: number; flags: string[]; kept: number; rounds: number; proposal: CardTopicProposalV2 }[] = []
  for (const f of files) {
    const loop = JSON.parse(readFileSync(f, 'utf8')) as Loop
    for (const o of loop.outcomes) {
      const klps = klpsOf.get(o.cardId)
      if (!klps || klps.length === 0) continue
      const kept = o.rounds[o.keptRound]
      let s = kltSettings({ klps, proposal: kept.proposal })
      // the round-trip assignment is not stored raw; carry the stored recovery and wandered list
      if (kept.settings.roundTrip !== undefined) s = { ...s, roundTrip: kept.settings.roundTrip, overall: (s.overall * 8 + kept.settings.roundTrip) / 9, detail: { ...s.detail, wandered: kept.settings.detail.wandered } }
      const e = enforcementReport(klps, [] as KlpLink[], toV1(kept.proposal))
      rows.push({ set: loop.setTitle ?? f, term: o.term, cardId: o.cardId, settings: s, enforcement: e.klpKltEnforcement, flags: barsMissed(s, e), kept: o.keptRound, rounds: o.rounds.length, proposal: kept.proposal })
    }
  }
  const keys = ['overall', 'coverage', 'anchored', 'causalEdges', 'causalTargets', 'brevity', 'vocabulary', 'noContainers', 'distinctness', 'roundTrip'] as const
  const dist = (vals: number[]) => { const v = [...vals].sort((a, b) => a - b); const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]; return v.length ? { mean: v.reduce((a, b) => a + b, 0) / v.length, p10: q(0.1), p25: q(0.25), p50: q(0.5), p90: q(0.9), n: v.length } : null }
  const summary: Record<string, ReturnType<typeof dist>> = {}
  for (const k of keys) summary[k] = dist(rows.map((r) => (r.settings as unknown as Record<string, number | undefined>)[k]).filter((x): x is number => typeof x === 'number'))
  summary.enforcement = dist(rows.map((r) => r.enforcement))
  const flagCounts: Record<string, number> = {}
  for (const r of rows) for (const fl of r.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1
  const bySet: Record<string, { cards: number; clear: number; overall: number; roundTrip: number; causalEdges: number }> = {}
  for (const r of rows) { const b = (bySet[r.set] ??= { cards: 0, clear: 0, overall: 0, roundTrip: 0, causalEdges: 0 }); b.cards += 1; if (r.flags.length === 0) b.clear += 1; b.overall += r.settings.overall; b.roundTrip += r.settings.roundTrip ?? 0; b.causalEdges += r.settings.causalEdges }
  for (const b of Object.values(bySet)) { b.overall /= b.cards; b.roundTrip /= b.cards; b.causalEdges /= b.cards }
  console.log(`[score-loop] ${rows.length} cards; clear ${rows.filter((r) => r.flags.length === 0).length}, flagged ${rows.filter((r) => r.flags.length > 0).length}; bars ${JSON.stringify(TOPIC_BARS)}`)
  for (const [k, d] of Object.entries(summary)) if (d) console.log(`  ${k.padEnd(14)} mean ${d.mean.toFixed(2)}  p10 ${d.p10.toFixed(2)}  p25 ${d.p25.toFixed(2)}  p50 ${d.p50.toFixed(2)}  p90 ${d.p90.toFixed(2)}`)
  console.log(`  flags: ${Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
  for (const [s, b] of Object.entries(bySet)) console.log(`  ${s.padEnd(26)} cards ${b.cards} clear ${b.clear} overall ${b.overall.toFixed(2)} roundTrip ${b.roundTrip.toFixed(2)} causalEdges ${b.causalEdges.toFixed(2)}`)
  const out = opt('--json')
  if (out) writeFileSync(out, JSON.stringify({ bars: TOPIC_BARS, summary, flagCounts, bySet, rows }, null, 1))
}
main()
