import { prisma } from '../src/lib/db'
import { carriedSeparation, loadBearingIndexes, probeOutcome, scoreDefinition } from '../src/lib/klp/definition-probe'
import { SEPARATION_FLOOR } from '../src/lib/klp/authoring-config'

/**
 * `npx tsx --conditions=react-server --env-file=.env scripts/probe-state.ts --set <setId>`
 *
 * READ-ONLY. One JSON document with the state of the authoring loop for a
 * set, per card at its LIVE key-point version: the owner's definition, the
 * points (role, weight, load-bearing), the links, the separations the bar
 * reads, the latest definition probe (score, verdicts, supervision,
 * decision) and the probe history across versions. Nothing here is a model's
 * opinion; every number is the stored TypeScript computation.
 */
function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main() {
  const setId = opt(process.argv.slice(2), '--set')
  if (!setId) {
    console.error('--set <setId> is required')
    process.exit(2)
  }
  const set = await prisma.set.findUnique({ where: { id: setId }, select: { title: true } })
  const cards = await prisma.card.findMany({ where: { setId }, orderBy: { createdAt: 'asc' } })
  const out: unknown[] = []
  for (const card of cards) {
    const klps = await prisma.cardKlp.findMany({ where: { cardId: card.id, supersededAt: null }, orderBy: { index: 'asc' } })
    const authoring = await prisma.cardAuthoring.findFirst({ where: { cardId: card.id, klpVersion: card.klpVersion }, orderBy: { createdAt: 'desc' }, include: { probes: true } })
    const relations = await prisma.klpRelation.findMany({ where: { fromKlpId: { in: klps.map((k) => k.id) } } })
    const byId = new Map(klps.map((k) => [k.id, k.index]))
    const loadBearing = authoring?.referenceVerdicts ? loadBearingIndexes(authoring.referenceVerdicts as string[], authoring.probes.map((p) => p.verdicts as Record<string, string>)) : new Set<number>()
    const probes = await prisma.definitionProbe.findMany({ where: { cardId: card.id }, orderBy: { createdAt: 'asc' } })
    // Card gaps from the latest question-only blind panel's reconciliations: what
    // a strong answer says that no key point covers. De-duplicated on the first
    // six words, because the same gap surfaces from several answers.
    const blindPanel = await prisma.graderPanel.findFirst({ where: { cardId: card.id, kind: 'blind-bands' }, orderBy: { klpVersion: 'desc' }, select: { id: true, klpVersion: true } })
    const reviews = blindPanel
      ? await prisma.graderPanelReview.findMany({ where: { result: { answer: { panelId: blindPanel.id } } }, select: { summary: true, outcome: true, points: true } })
      : []
    const gapSeen = new Set<string>()
    const cardGaps: string[] = []
    for (const r of reviews) {
      const m = r.summary.indexOf('CARD GAPS:')
      if (m < 0) continue
      for (const line of r.summary.slice(m + 'CARD GAPS:'.length).split('\n')) {
        const g = line.replace(/^-\s*/, '').trim()
        if (!g) continue
        const key = g.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 6).join(' ')
        if (gapSeen.has(key)) continue
        gapSeen.add(key)
        cardGaps.push(g)
      }
    }
    const pointDefects = reviews.flatMap((r) => ((r.points as { klpRef: number; stance: string; reason: string }[]) ?? []).filter((pt) => pt.stance === 'klp_defect').map((pt) => ({ klpRef: pt.klpRef, reason: pt.reason })))
    const latest = probes.filter((p) => p.klpVersion === card.klpVersion).at(-1) ?? null
    const probeScore = latest ? scoreDefinition(latest.verdicts as { klpRef: number; status: string }[], klps.map((k) => ({ index: k.index, text: k.text, weight: k.weight, kind: k.kind }))) : null
    out.push({
      card: { id: card.id, term: card.term, definition: card.definition, klpVersion: card.klpVersion },
      klps: klps.map((k) => ({ index: k.index, text: k.text, kind: k.kind, role: k.role, weight: k.weight, loadBearing: loadBearing.has(k.index) })),
      relations: relations.map((r) => ({ type: r.type, from: byId.get(r.fromKlpId) ?? null, to: byId.get(r.toKlpId) ?? null })),
      authoring: authoring
        ? {
            status: authoring.status,
            separationScore: authoring.separationScore,
            substanceSeparation: authoring.substanceSeparation,
            relationSeparation: authoring.relationSeparation,
            combinedSeparation: authoring.combinedSeparation,
            carried: carriedSeparation(authoring),
            aboveFloor: carriedSeparation(authoring) >= SEPARATION_FLOOR,
            revisions: authoring.revisions,
            referenceAnswer: authoring.referenceAnswer,
            referenceWords: authoring.referenceAnswer.split(/\s+/).filter(Boolean).length,
            traps: authoring.probes.map((p) => ({ kind: p.kind, score: p.score, verdicts: p.verdicts, relationVerdicts: p.relationVerdicts })),
          }
        : null,
      probe: latest
        ? {
            score: latest.score,
            outcome: latest.outcome,
            decision: latest.decision,
            model: latest.model,
            verdicts: latest.verdicts,
            omitted: probeScore?.omitted ?? [],
            partial: probeScore?.partial ?? [],
            wrong: probeScore?.wrong ?? [],
            supervision: latest.supervision,
            findings: latest.findings,
          }
        : null,
      history: probes.map((p) => ({ klpVersion: p.klpVersion, score: Math.round(p.score * 100), outcome: probeOutcome(p.score), decision: p.decision, at: p.createdAt.toISOString() })),
      blind: blindPanel ? { klpVersion: blindPanel.klpVersion, reviews: reviews.length, cardGaps, pointDefects } : null,
    })
  }
  process.stdout.write(JSON.stringify({ setId, title: set?.title ?? null, floor: SEPARATION_FLOOR, generatedAt: new Date().toISOString(), cards: out }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
