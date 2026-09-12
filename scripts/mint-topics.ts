/**
 * mint-topics — the WRITE STEP of topic minting (BUILD-QUEUE item 2).
 *
 * Reads the merged proposals a `probe-topic-minting --dual` run stored, plans
 * the rows each card would write (`src/lib/klt/mint-plan.ts`), prints the
 * plan, and — ONLY with `--write` — persists it (`src/lib/klt/mint-write.ts`).
 *
 * The probe measures and never writes; this script writes what a merge the
 * operator has READ says. Keeping them apart is deliberate: the merge rules
 * changed three times on 2026-09-11 and every change was measured by
 * replaying stored proposals. A writer that re-minted on the fly would have
 * been writing a different merge every time.
 *
 * Usage:
 *   npx tsx --conditions=react-server --env-file=.env scripts/mint-topics.ts \
 *     --from <dual.json> [--write] [--only <cardId,...>]
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { loadSetTree } from '../src/lib/klt/structure'
import { planMintWrites, type MintWritePlan } from '../src/lib/klt/mint-plan'
import { persistMintWrites } from '../src/lib/klt/mint-write'
import type { MergedProposal } from '../src/lib/klp/topic-reconcile'

interface StoredResult {
  id: string
  term: string
  setTitle: string
  klps: { text: string; kind: string }[]
  deepseek?: { model: string }
  gemini?: { model: string }
  merged?: MergedProposal
  error?: string
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function printPlan(r: StoredResult, plan: MintWritePlan, existingGlobal: Set<string>): void {
  console.log(`── "${r.term.slice(0, 64)}"   [${r.setTitle}]`)
  const fresh = plan.concepts.filter((c) => !existingGlobal.has(c.normalizedName))
  console.log(`   concepts: ${plan.concepts.length} (${fresh.length} new, ${plan.concepts.length - fresh.length} reused)`)
  for (const c of plan.concepts) {
    const tag = existingGlobal.has(c.normalizedName) ? 'reuse' : 'NEW  '
    console.log(`     ${tag} ${c.role.padEnd(8)} ${c.name}${c.reusedFrom ? `   (minted as "${c.reusedFrom}")` : ''}`)
  }
  console.log(`   placements: ${plan.paths.map((p) => p.join(' > ')).join(' | ')}`)
  console.log(`   links: ${plan.klpTopics.length} (${plan.klpTopics.filter((t) => t.rank === 1).length} rank-1, ${plan.klpTopics.filter((t) => t.rank === 2).length} rank-2)`)
  for (const rel of plan.relations) console.log(`   edge: ${rel.from} --${rel.type}--> ${rel.to}  (${rel.klpIds.length} klp)`)
  if (plan.unplaced.length) console.log(`   unplaced endpoints: ${plan.unplaced.join(', ')}`)
  for (const n of plan.notes) console.log(`   · ${n}`)
  console.log()
}

async function main() {
  const args = process.argv.slice(2)
  const from = opt(args, '--from')
  if (!from) {
    console.error('[mint-topics] --from <dual.json> is required')
    process.exit(1)
  }
  const write = args.includes('--write')
  const only = (opt(args, '--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const stored = JSON.parse(readFileSync(from, 'utf8')) as { results: StoredResult[] }
  let results = stored.results.filter((r) => r.merged)
  if (only.length) results = results.filter((r) => only.includes(r.id))
  if (results.length === 0) {
    console.error('[mint-topics] nothing to do — no merged results matched')
    process.exit(1)
  }
  console.log(`[mint-topics] ${write ? 'WRITE' : 'PLAN ONLY'} — ${results.length} card(s) from ${from}\n`)

  const existingGlobal = new Set((await prisma.klt.findMany({ select: { normalizedName: true } })).map((k) => k.normalizedName))
  const cards = await prisma.card.findMany({
    where: { id: { in: results.map((r) => r.id) } },
    select: { id: true, setId: true, klps: { where: { supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, text: true } } },
  })
  const setNames = new Map<string, { name: string; normalizedName: string }[]>()

  let totals = { concepts: 0, fresh: 0, links: 0, edges: 0, unplaced: 0, written: 0, cyclesSkipped: 0 }
  for (const r of results) {
    const card = cards.find((c) => c.id === r.id)
    if (!card) {
      console.log(`  SKIP "${r.term.slice(0, 50)}" — card not found`)
      continue
    }
    // The proposal indexed the KLPs as they were when minted; refuse to write
    // links onto a card whose KLP set has changed since.
    const drift = card.klps.length !== r.klps.length || card.klps.some((k, i) => k.text !== r.klps[i]?.text)
    if (drift) {
      console.log(`  SKIP "${r.term.slice(0, 50)}" — the card's KLPs changed since the proposal was minted; re-mint first`)
      continue
    }
    if (!setNames.has(card.setId)) {
      const rows = await loadSetTree(card.setId)
      setNames.set(card.setId, rows.map((row) => ({ name: row.name, normalizedName: row.normalizedName })))
    }
    const plan = planMintWrites({ cardId: card.id, klpIds: card.klps.map((k) => k.id), merged: r.merged!, existingSetNames: setNames.get(card.setId)! })
    printPlan(r, plan, existingGlobal)
    const fresh = plan.concepts.filter((c) => !existingGlobal.has(c.normalizedName)).length
    totals.concepts += plan.concepts.length
    totals.fresh += fresh
    totals.links += plan.klpTopics.length
    totals.edges += plan.relations.length
    totals.unplaced += plan.unplaced.length

    if (write) {
      const models = [r.deepseek?.model, r.gemini?.model].filter((m): m is string => !!m)
      const res = await persistMintWrites(card.setId, plan, models)
      totals.written++
      totals.cyclesSkipped += res.relationsSkippedForCycles.length
      console.log(`   WROTE: ${res.concepts} concepts, placements +${res.placements.created}/${res.placements.skipped} skipped, ${res.klpTopics} links, ${res.relationsWritten} edges` + (res.relationsSkippedForCycles.length ? `, cycle-skipped: ${res.relationsSkippedForCycles.join('; ')}` : ''))
      // Names written now exist for the next card's reuse.
      for (const c of plan.concepts) {
        existingGlobal.add(c.normalizedName)
        const list = setNames.get(card.setId)!
        if (!list.some((n) => n.normalizedName === c.normalizedName)) list.push({ name: c.name, normalizedName: c.normalizedName })
      }
      console.log()
    }
  }
  console.log('='.repeat(72))
  console.log(`cards: ${results.length}   concepts: ${totals.concepts} (${totals.fresh} new)   links: ${totals.links}   edges: ${totals.edges}   unplaced endpoints: ${totals.unplaced}`)
  if (write) console.log(`written: ${totals.written} card(s); edges skipped for cycles: ${totals.cyclesSkipped}`)
  else console.log(`PLAN ONLY — re-run with --write to persist.`)
}

main().finally(() => process.exit(0))
