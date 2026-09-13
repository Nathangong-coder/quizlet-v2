import { prisma } from '../src/lib/db'
import {
  buildWeightHistogram,
  diagnoseWeightHistogram,
  buildBreadthHistogram,
  failCountsFromVerdicts,
  formatWeightHistogram,
  formatBreadthHistogram,
} from '../src/lib/klp/histogram'
import { PROBE_KINDS } from '../src/lib/klp/authoring-config'
import { authoredVersionKeys, classifyProvenance } from '../src/lib/klp/provenance'

/**
 * `npm run klp-histogram` — the weight distribution of the live corpus, and
 * the verdict on whether it is a usable signal (increment A §1, §7).
 *
 * Read-only. It writes nothing and takes no AI call, so it is safe to run
 * against production at any time and costs nothing to re-run after every
 * authoring pass.
 *
 * WHY THIS EXISTS AS ITS OWN COMMAND. Audit finding G1 was a measurement —
 * 92.3% of AI-assigned weights at 4 or 5 — and replacing the AI's opinion with
 * `weightFromSignals` is a hypothesis about that measurement. The histogram is
 * the only thing that can say whether the hypothesis held. It deliberately
 * ships BEFORE the corpus is re-authored: a check written afterwards can only
 * be read once the evidence it would have judged is already overwritten.
 *
 * It splits the corpus by PROVENANCE — KLPs written by the authoring pipeline
 * versus everything else — because a mixed number answers nothing. Early on,
 * the authored slice is tiny and the legacy slice is the G1 baseline; the point
 * of the run is the difference between them, not the total.
 *
 * Flags:
 *   --set <setId>   scope to one set (the shape you want during a pilot)
 *   --json          machine-readable output, for pasting into a design doc
 */

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  const asJson = args.includes('--json')

  const klps = await prisma.cardKlp.findMany({
    where: {
      supersededAt: null,
      ...(setId ? { card: { setId } } : {}),
    },
    select: { cardId: true, version: true, index: true, weight: true, promptVersion: true },
  })

  if (klps.length === 0) {
    console.log(setId ? `[klp-histogram] no live KLPs in set ${setId}` : '[klp-histogram] no live KLPs')
    return
  }

  const cardIds = Array.from(new Set(klps.map((k) => k.cardId)))
  const authorings = await prisma.cardAuthoring.findMany({
    where: { cardId: { in: cardIds } },
    select: {
      cardId: true,
      klpVersion: true,
      status: true,
      probes: { select: { verdicts: true } },
    },
  })

  // THE THREE-WAY PROVENANCE SPLIT — authored / reused / legacy — and its full
  // reasoning now live in `src/lib/klp/provenance.ts`, because
  // `npm run klp-exploit` reports over the same slices. Two definitions of
  // "authored" that drift apart would make two reports over one corpus
  // disagree about which slice each was measuring, which reads as a finding.
  const authoredKeys = authoredVersionKeys(authorings)
  const authored = klps.filter((k) => classifyProvenance(k, authoredKeys) === 'authored')
  const reused = klps.filter((k) => classifyProvenance(k, authoredKeys) === 'reused')
  const legacy = klps.filter((k) => classifyProvenance(k, authoredKeys) === 'legacy')

  const overallHist = buildWeightHistogram(klps.map((k) => k.weight))
  const authoredHist = buildWeightHistogram(authored.map((k) => k.weight))
  const reusedHist = buildWeightHistogram(reused.map((k) => k.weight))
  const legacyHist = buildWeightHistogram(legacy.map((k) => k.weight))

  // Breadth, over the authored slice only — a legacy KLP has no adversaries and
  // therefore no breadth, and padding the distribution with zeros for it would
  // manufacture a flatness finding out of rows that were never measured.
  const klpsPerCardVersion = new Map<string, number>()
  for (const k of klps) {
    const key = `${k.cardId}@${k.version}`
    klpsPerCardVersion.set(key, Math.max(klpsPerCardVersion.get(key) ?? 0, k.index + 1))
  }

  const allFailCounts: number[] = []
  let probesPerCard: number = PROBE_KINDS.length
  for (const a of authorings) {
    const count = klpsPerCardVersion.get(`${a.cardId}@${a.klpVersion}`)
    if (!count) continue
    const { failCounts, wrongAnswerCount } = failCountsFromVerdicts(a.probes, count)
    if (wrongAnswerCount === 0) continue
    probesPerCard = Math.max(probesPerCard, wrongAnswerCount)
    allFailCounts.push(...failCounts)
  }
  const breadthHist = buildBreadthHistogram(allFailCounts, probesPerCard)

  const authoredFindings = diagnoseWeightHistogram(authoredHist)
  const reusedFindings = diagnoseWeightHistogram(reusedHist)
  const legacyFindings = diagnoseWeightHistogram(legacyHist)
  const overallFindings = diagnoseWeightHistogram(overallHist)

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          scope: setId ?? 'all sets',
          overall: { histogram: overallHist, findings: overallFindings },
          authored: { histogram: authoredHist, findings: authoredFindings },
          reused: { histogram: reusedHist, findings: reusedFindings },
          legacy: { histogram: legacyHist, findings: legacyFindings },
          breadth: breadthHist,
          authoringRuns: authorings.length,
          lowDiscriminationRuns: authorings.filter((a) => a.status === 'low_discrimination').length,
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(`[klp-histogram] scope: ${setId ?? 'all sets'} — ${klps.length} live KLPs on ${cardIds.length} cards\n`)

  console.log('=== AUTHORED (discrimination-tested pipeline, weight computed in TypeScript) ===')
  console.log(formatWeightHistogram(authoredHist, authoredFindings))
  console.log()
  console.log(formatBreadthHistogram(breadthHist))
  console.log()

  if (reused.length > 0) {
    console.log('=== REUSED (copied from a byte-identical card, zero AI calls) ===')
    console.log('Authored weights, on cards that were never authored themselves. Judged separately')
    console.log('because they measure the DONOR pipeline, not this card - counting them as authored')
    console.log('would report the same run once per duplicate.')
    console.log(formatWeightHistogram(reusedHist, reusedFindings))
    console.log()
  }

  console.log('=== LEGACY (single-pass extractor, weight assigned by the model) ===')
  console.log('This slice is the G1 BASELINE. It is expected to fail clustered_high; that is the')
  console.log('finding the authoring pipeline exists to fix, not a regression to chase.')
  console.log(formatWeightHistogram(legacyHist, legacyFindings))
  console.log()

  console.log('=== WHOLE CORPUS (every provenance mixed — reported last, and least useful) ===')
  console.log(formatWeightHistogram(overallHist, overallFindings))
  console.log()

  const lowDiscrimination = authorings.filter((a) => a.status === 'low_discrimination').length
  console.log(
    `Authoring runs: ${authorings.length} (${lowDiscrimination} low_discrimination). ` +
      `Read a low KLP count beside its separation score, never alone — sizing is adaptive.`,
  )
}

main()
  .catch((err) => {
    console.error('[klp-histogram] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
