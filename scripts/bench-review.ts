import { prisma } from '../src/lib/db'
import { readPanelResult, coverageScore, rankAgreement, adjacentGaps, toBenchKlpVerdicts, toBenchRelationVerdicts } from '../src/lib/analysis/benchmark'
import { answerScore, compositionOf, GRADER_SCORING } from '../src/lib/analysis/scoring-rules'
import { GRADER_VERSION } from '../src/lib/analysis/version'

/**
 * `npx tsx --conditions=react-server --env-file=.env scripts/bench-review.ts --set <setId> [--model <id>] [--kind levels|modes|blind|bands|blind-bands]`
 *
 * READ-ONLY. Dumps one JSON document for a human review of the grader
 * benchmark: every card's key points, the adversary's four answers with the
 * rank and rationale it INTENDED, and the grader's per-point verdicts with
 * the quotes it cited — so an owner can judge, answer by answer, whether the
 * instrument graded the right way and harshly enough. Nothing here is a
 * score the model gave; the scores are TypeScript's.
 */
function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  if (!setId) {
    console.error('--set <setId> is required')
    process.exit(2)
  }
  const model = opt(args, '--model')
  const kind = opt(args, '--kind') ?? 'levels'

  const rules = GRADER_SCORING
  const cards = await prisma.card.findMany({
    where: { setId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, term: true, definition: true },
  })

  const out: unknown[] = []
  for (const card of cards) {
    const panel = await prisma.graderPanel.findFirst({
      where: { cardId: card.id, kind },
      orderBy: { klpVersion: 'desc' },
      include: {
        answers: {
          orderBy: { intendedRank: 'asc' },
          include: {
            results: {
              where: { graderVersion: GRADER_VERSION, ...(model ? { model } : {}) },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
            },
          },
        },
      },
    })
    if (!panel) {
      out.push({ card: { id: card.id, term: card.term }, panel: null })
      continue
    }
    const klps = await prisma.cardKlp.findMany({
      where: { cardId: card.id, supersededAt: null },
      orderBy: { index: 'asc' },
      select: { id: true, index: true, text: true, kind: true, role: true, weight: true },
    })
    const relations = await prisma.klpRelation.findMany({
      where: { fromKlpId: { in: klps.map((k) => k.id) }, toKlpId: { in: klps.map((k) => k.id) } },
      select: { id: true, type: true, fromKlpId: true, toKlpId: true },
    })
    const authoring = await prisma.cardAuthoring.findFirst({
      where: { cardId: card.id, klpVersion: panel.klpVersion },
      orderBy: { createdAt: 'desc' },
      select: { referenceAnswer: true },
    })
    const byId = new Map(klps.map((k) => [k.id, k]))
    const answers = panel.answers.map((a) => {
      const row = a.results[0]
      if (!row) return { level: a.level, mode: a.mode, intendedRank: a.intendedRank, text: a.text, rationale: a.rationale, result: null }
      const r = readPanelResult(row)
      const bk = toBenchKlpVerdicts(r.verdicts)
      const br = toBenchRelationVerdicts(r.relationVerdicts)
      const score = answerScore(bk, br, r.unjudged)
      const coverage = coverageScore(bk, r.unjudged)
      const composition = compositionOf(bk, br, r.unjudged)
      return {
        level: a.level,
        mode: a.mode,
        intendedRank: a.intendedRank,
        text: a.text,
        rationale: a.rationale,
        result: {
          model: row.model,
          score,
          coverage,
          composition,
          expression: (row as { expression?: unknown }).expression ?? null,
          review: row.reviews[0]
            ? { outcome: row.reviews[0].outcome, disagreement: row.reviews[0].disagreement, summary: row.reviews[0].summary, points: row.reviews[0].points, manualVerdict: row.reviews[0].manualVerdict }
            : null,
          unresolvedQuotes: r.unresolvedQuotes,
          unjudged: r.unjudged.map((u) => ({ index: byId.get(u.klpId)?.index ?? null, weight: u.weight })),
          verdicts: r.verdicts.map((v) => ({
            index: byId.get(v.klpId)?.index ?? v.klpRef,
            status: v.status,
            weight: v.weight,
            quote: v.quote ?? null,
            resolved: v.spanStart !== null,
          })),
          relationVerdicts: r.relationVerdicts.map((v) => {
            const rel = relations.find((x) => x.id === v.relationId)
            return {
              ref: v.relationRef,
              type: rel?.type ?? null,
              from: rel ? byId.get(rel.fromKlpId)?.index ?? null : null,
              to: rel ? byId.get(rel.toKlpId)?.index ?? null : null,
              status: v.status,
              quote: v.quote ?? null,
            }
          }),
          formVerdicts: r.formVerdicts.map((v) => ({ ref: v.formRef, status: v.status, quote: v.quote ?? null })),
        },
      }
    })
    const ranked = answers.filter((a) => a.result).map((a) => ({ intendedRank: a.intendedRank, score: a.result!.score }))
    out.push({
      card: { id: card.id, term: card.term, definition: card.definition },
      referenceAnswer: authoring?.referenceAnswer ?? null,
      klps: klps.map((k) => ({ index: k.index, text: k.text, kind: k.kind, role: k.role, weight: k.weight })),
      relations: relations.map((r) => ({ type: r.type, from: byId.get(r.fromKlpId)?.index ?? null, to: byId.get(r.toKlpId)?.index ?? null })),
      panel: { kind: panel.kind, model: panel.model, promptVersion: panel.promptVersion },
      rank: ranked.length === 4 ? rankAgreement(ranked) : null,
      gaps: ranked.length === 4 ? adjacentGaps(ranked) : null,
      answers,
    })
  }
  process.stdout.write(JSON.stringify({ setId, kind, model: model ?? null, graderVersion: GRADER_VERSION, scoring: rules, cards: out }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
