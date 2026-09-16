/**
 * Paired comparison of two authoring generations on one set — the "should we
 * revert" instrument (2026-09-13, owner: "if you see that separation & parity
 * are going down as a result, then probably you should be reverting").
 *
 * For every card in the set, the LATEST CardAuthoring row is the new
 * generation and the latest row BEFORE it is the old one. Prints per-card
 * separation / substance / parity / coverage / KLP count for both, the
 * paired mean difference, and how many cards moved each way. Read-only.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/compare-authoring-runs.ts --set <setId>
 */
import { prisma } from '../src/lib/db'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const setId = opt('--set')
  if (!setId) throw new Error('--set <setId> is required')
  const set = await prisma.set.findUnique({ where: { id: setId }, select: { title: true } })
  const cards = await prisma.card.findMany({ where: { setId }, select: { id: true, term: true }, orderBy: { createdAt: 'asc' } })
  const rows = await prisma.cardAuthoring.findMany({
    where: { cardId: { in: cards.map((c) => c.id) } },
    orderBy: { createdAt: 'desc' },
    select: { cardId: true, klpVersion: true, separationScore: true, substanceSeparation: true, referenceParity: true, cardCoverage: true, status: true, model: true, createdAt: true },
  })
  const klpCounts = await prisma.cardKlp.groupBy({ by: ['cardId', 'version'], where: { cardId: { in: cards.map((c) => c.id) } }, _count: { _all: true } })
  const countOf = (cardId: string, version: number) => klpCounts.find((k) => k.cardId === cardId && k.version === version)?._count._all ?? 0

  const f = (x: number | null | undefined) => (x == null ? '  —  ' : x.toFixed(2))
  const pairs: { term: string; oldR: (typeof rows)[number]; newR: (typeof rows)[number] }[] = []
  console.log(`${set?.title ?? setId} — latest authoring vs the one before, per card\n`)
  console.log('card'.padEnd(46) + '|  old: sep  par   cov  n  status         |  new: sep  sub   par   cov  n  status')
  for (const c of cards) {
    const mine = rows.filter((r) => r.cardId === c.id)
    if (mine.length < 2) continue
    // The old generation is the latest row with a DIFFERENT model label —
    // a re-run of the same configuration (a killed run's leftovers) is not
    // the comparison this instrument is for.
    const newR = mine[0]
    const oldR = mine.find((r) => r.model !== newR.model) ?? mine[1]
    pairs.push({ term: c.term, oldR, newR })
    console.log(
      `${c.term.slice(0, 44).padEnd(46)}| ${f(oldR.separationScore)} ${f(oldR.referenceParity)} ${f(oldR.cardCoverage)} ${String(countOf(c.id, oldR.klpVersion)).padStart(2)}  ${oldR.status.slice(0, 14).padEnd(14)} | ${f(newR.separationScore)} ${f(newR.substanceSeparation)} ${f(newR.referenceParity)} ${f(newR.cardCoverage)} ${String(countOf(c.id, newR.klpVersion)).padStart(2)}  ${newR.status.slice(0, 14)}`,
    )
  }
  const paired = (pick: (r: (typeof rows)[number]) => number | null) => {
    const d = pairs.map((p) => [pick(p.oldR), pick(p.newR)]).filter(([a, b]) => a != null && b != null) as [number, number][]
    if (d.length === 0) return 'no pairs'
    const mo = d.reduce((s, [a]) => s + a, 0) / d.length
    const mn = d.reduce((s, [, b]) => s + b, 0) / d.length
    const up = d.filter(([a, b]) => b > a + 0.05).length
    const down = d.filter(([a, b]) => b < a - 0.05).length
    return `${d.length} pairs: old ${mo.toFixed(3)} → new ${mn.toFixed(3)} (Δ ${(mn - mo >= 0 ? '+' : '')}${(mn - mo).toFixed(3)}); up ${up}, down ${down}, within ±0.05 ${d.length - up - down}`
  }
  console.log(`\nseparation (full)  ${paired((r) => r.separationScore)}`)
  console.log(`parity             ${paired((r) => r.referenceParity)}`)
  console.log(`coverage           ${paired((r) => r.cardCoverage)}`)
  const lowOld = pairs.filter((p) => p.oldR.status === 'low_discrimination').length
  const lowNew = pairs.filter((p) => p.newR.status === 'low_discrimination').length
  console.log(`low_discrimination old ${lowOld} → new ${lowNew}`)
  const nOld = pairs.reduce((s, p) => s + countOf(p.oldR.cardId, p.oldR.klpVersion), 0) / Math.max(1, pairs.length)
  const nNew = pairs.reduce((s, p) => s + countOf(p.newR.cardId, p.newR.klpVersion), 0) / Math.max(1, pairs.length)
  console.log(`KLPs per card      old ${nOld.toFixed(2)} → new ${nNew.toFixed(2)}`)
  console.log(`models             old ${[...new Set(pairs.map((p) => p.oldR.model))].join(' | ')}\n                   new ${[...new Set(pairs.map((p) => p.newR.model))].join(' | ')}`)
  await prisma.$disconnect()
}
main()
