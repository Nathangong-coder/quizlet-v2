import { prisma } from '../src/lib/db'
import type { KlpVerdict } from '../src/lib/klp/verdicts'
import {
  auc,
  credits,
  entropy,
  mean,
  mutualInformation,
  verdictList,
  type VerdictList,
} from '../src/lib/klp/discrimination-stats'

/**
 * `npm run klp-stats [-- --set <setId>]` — the authoring corpus scored by
 * THREE measures instead of one, so the shipped one can be checked.
 *
 * READ-ONLY. No AI calls, no writes.
 *
 * WHY THIS EXISTS. `separation = referenceScore - bestWrongScore` is a
 * difference of means over an ordinal scale mapped to {0, 0.5, 1}. That is a
 * defensible choice and it is also an ASSUMPTION — that "partial" sits exactly
 * halfway, and that a grader's harshness cancels in the subtraction. A second
 * and third measure that make DIFFERENT assumptions are the only way to find
 * out whether the first one is carrying them.
 *
 * If all three rank the models the same way, the shipped number is fine and
 * this run is a null result worth having. If they disagree, the disagreement
 * localises the assumption that broke.
 */

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

interface ModelStats {
  cards: number
  separation: number[]
  auc: number[]
  miFraction: number[]
  deadKlps: number
  totalKlps: number
}

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')

  const authorings = await prisma.cardAuthoring.findMany({
    where: setId ? { card: { setId } } : {},
    select: {
      model: true,
      separationScore: true,
      referenceVerdicts: true,
      probes: { select: { kind: true, score: true, verdicts: true } },
    },
  })

  const byModel = new Map<string, ModelStats>()

  let missingReference = 0

  for (const run of authorings) {
    if (run.probes.length === 0) continue

    const wrongScores = run.probes.map((p) => p.score)

    // The reference score is RECOVERABLE on every row, new or old:
    // separation = referenceScore - max(wrongScore), so the reference score is
    // the separation plus the best wrong score. Both halves are stored.
    // AUC therefore covers the whole corpus with no backfill.
    const refScore = run.separationScore + Math.max(...wrongScores)

    // Per-KLP mutual information needs the reference's verdicts, which were
    // discarded until 2026-09-07. Rows without them are counted and skipped
    // rather than guessed at.
    const reference = (run.referenceVerdicts ?? null) as VerdictList | null
    let dead = 0
    let miSum = 0
    let counted = 0
    if (reference && reference.length > 0) {
      const refCredits = credits(reference)
      const wrongCredits = run.probes.map((p) => credits(verdictList(p.verdicts)))
      for (let k = 0; k < refCredits.length; k++) {
        const labels = [refCredits[k], ...wrongCredits.map((w) => w[k] ?? 0)]
        const classes = [1, ...wrongCredits.map(() => 0)]
        const h = entropy(classes)
        const mi = mutualInformation(labels, classes)
        if (mi === 0) dead += 1
        if (h > 0) {
          miSum += mi / h
          counted += 1
        }
      }
    } else {
      missingReference += 1
    }

    const key = run.model ?? 'unknown'
    const stats = byModel.get(key) ?? {
      cards: 0,
      separation: [],
      auc: [],
      miFraction: [],
      deadKlps: 0,
      totalKlps: 0,
    }
    stats.cards += 1
    stats.separation.push(run.separationScore)
    stats.auc.push(auc(refScore, wrongScores))
    if (counted > 0) {
      stats.miFraction.push(miSum / counted)
      stats.deadKlps += dead
      stats.totalKlps += counted
    }
    byModel.set(key, stats)
  }

  console.log(`[klp-stats] scope: ${setId ?? 'all sets'} — ${authorings.length} authoring runs\n`)
  console.log('model                     cards   sep     AUC    MI/H   dead KLPs')
  console.log('-'.repeat(70))

  const rows = [...byModel.entries()].sort((a, b) => mean(b[1].separation) - mean(a[1].separation))
  for (const [model, s] of rows) {
    const deadPct = s.totalKlps === 0 ? 0 : (s.deadKlps / s.totalKlps) * 100
    console.log(
      `${model.padEnd(24)} ${String(s.cards).padStart(5)}   ` +
        `${mean(s.separation).toFixed(3)}  ${mean(s.auc).toFixed(3)}  ` +
        `${mean(s.miFraction).toFixed(3)}   ${deadPct.toFixed(1)}%`,
    )
  }

  if (missingReference > 0) {
    console.log()
    console.log(
      `MI/H and dead are blank or partial: ${missingReference} of ${authorings.length} runs predate`,
    )
    console.log(
      'referenceVerdicts (added 2026-09-07) and cannot be recovered without re-grading.',
    )
    console.log('AUC and sep cover every run — the reference score is recoverable arithmetically.')
  }

  console.log()
  console.log('sep    separation = referenceScore - bestWrongScore. The shipped number.')
  console.log('AUC    P(reference outscores a random adversary), ties half. Rank-based, so')
  console.log('       immune to a uniformly harsh grader and to the {0, .5, 1} credit scale.')
  console.log('MI/H   mean per-KLP mutual information with the good/bad label, as a fraction')
  console.log('       of its ceiling. 0 means the KLP fired identically on every candidate.')
  console.log('dead   KLPs at exactly MI = 0 — grading cost that buys no information.')
  console.log()
  console.log('The three make different assumptions. Agreement is evidence the shipped')
  console.log('number is sound; disagreement localises which assumption failed.')
}

main()
  .catch((error) => {
    console.error('[klp-stats] failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
