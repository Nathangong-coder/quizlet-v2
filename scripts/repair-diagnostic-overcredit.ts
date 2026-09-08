import { prisma } from '../src/lib/db'
import { rebuildKlpStates, lockKlpStates } from '../src/lib/metrics/state-writer'
import { ANALYSIS_TX_OPTIONS } from '../src/lib/analysis/write-answer'
import { normalizeKlpText } from '../src/lib/klp/regrade'

/**
 * ONE-OFF REPAIR, 2026-09-08. Removes evidence that `npm run regrade-klps`
 * invented on diagnostic answers before `diagnostic` was moved to
 * `CARRY_ONLY_MODES`.
 *
 * ## What went wrong
 *
 * The first version of the re-grade job classified modes by FORMAT — is the
 * answer free text? — and a diagnostic answer is free text, so it was re-graded
 * through `GRADE_SHORT_ANSWER_PROMPT`. That prompt judges an answer against the
 * card's WHOLE key-point set.
 *
 * But a diagnostic question probes EXACTLY ONE key point
 * (`DiagnosticQuestion.klpId`; "only what it asked was credited" is true by
 * construction). So the re-grade asked the grader to judge a one-point answer
 * against five or six points, and the grader did what it was told: it marked
 * the untouched points `failed`, because an answer to one question does not
 * mention the others.
 *
 * The result was not neutral noise, it was systematic false negatives in a real
 * learner's history. One measured case: asked "What metric is produced when
 * COGS is subtracted from Revenue?", the learner answered "Gross Profit" —
 * correct — and came out recorded as having FAILED four key points covering
 * operating expenses, EBIT, EBITDA and net income.
 *
 * ## What the honest state is
 *
 * A diagnostic answer's scope is its one probed key point. It can only be
 * carried forward if that point survived re-authoring VERBATIM. Checked across
 * all 12 diagnostic questions on this database: **not one target survived** —
 * the cards were re-authored from the legacy extractor, which rewrote every
 * text. So the correct outcome for every one of them is to keep NO key-point
 * evidence at all, exactly as the fixed planner now produces.
 *
 * That is a real loss, and it is the loss that was already there: the evidence
 * had been stranded on superseded points since the re-authoring. This does not
 * destroy anything the learner still had — it removes rows the repair itself
 * fabricated and returns the answers to `no_provenance`, which is what "we
 * cannot attribute this" is supposed to look like.
 *
 * `DiagnosticQuestion`, its prompt, the learner's answer, `score`, `status`,
 * `feedback` and every `StudyEvent` are untouched. Only key-point attribution
 * is removed.
 *
 * Idempotent: re-running finds nothing to do. `--dry-run` reports without
 * writing.
 */

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const questions = await prisma.diagnosticQuestion.findMany({
    where: { quizAnswerId: { not: null }, klpId: { not: null } },
    select: {
      id: true,
      klpId: true,
      prompt: true,
      quizAnswerId: true,
      quizAnswer: {
        select: {
          id: true,
          userId: true,
          cardId: true,
          klpResults: { select: { klpId: true } },
        },
      },
    },
  })

  let repaired = 0
  let removed = 0
  let keptInScope = 0

  for (const q of questions) {
    const answer = q.quizAnswer
    if (!answer || answer.klpResults.length === 0) continue

    const target = await prisma.cardKlp.findUnique({
      where: { id: q.klpId! },
      select: { text: true },
    })
    const live = await prisma.cardKlp.findMany({
      where: { cardId: answer.cardId, supersededAt: null },
      select: { id: true, text: true },
    })

    // The ONLY row this answer may legitimately carry: a verdict on the very
    // key point the question probed, if that proposition survived verbatim.
    const inScope = target
      ? live.find((l) => normalizeKlpText(l.text) === normalizeKlpText(target.text))?.id
      : undefined

    const toRemove = answer.klpResults.filter((r) => r.klpId !== inScope).map((r) => r.klpId)
    if (toRemove.length === 0) continue

    console.log(
      `${dryRun ? '[dry-run] ' : ''}${answer.id} — removing ${toRemove.length} out-of-scope ` +
        `result(s)${inScope ? ', keeping the probed point' : ', keeping none'} :: ` +
        `${q.prompt.slice(0, 70)}`,
    )
    repaired += 1
    removed += toRemove.length
    if (inScope) keptInScope += 1

    if (dryRun) continue

    // Every id the answer touched — the removed ones need their posteriors
    // replayed without the fabricated observation, and the kept one needs
    // replaying too since its state absorbed the same pass.
    const affected = [...new Set(answer.klpResults.map((r) => r.klpId))]

    await prisma.$transaction(async (tx) => {
      await lockKlpStates(tx, answer.userId, affected)
      await tx.answerKlpResult.deleteMany({
        where: { quizAnswerId: answer.id, klpId: { in: toRemove } },
      })
      // Error tags targeting a removed point lose their target rather than the
      // tag: `klpId: null` already means "about the whole answer".
      await tx.answerErrorTag.updateMany({
        where: { quizAnswerId: answer.id, klpId: { in: toRemove } },
        data: { klpId: null },
      })
      await tx.quizAnswer.update({
        where: { id: answer.id },
        data: { analysisStatus: inScope ? 'analyzed' : 'no_provenance' },
      })
      await rebuildKlpStates(tx, answer.userId, affected)
    }, ANALYSIS_TX_OPTIONS)
  }

  console.log()
  console.log(
    `[repair] ${repaired} diagnostic answer(s) ${dryRun ? 'would be' : ''} repaired, ` +
      `${removed} fabricated result(s) removed, ${keptInScope} kept an in-scope verdict.`,
  )
  if (repaired === 0) console.log('[repair] nothing to do — no out-of-scope evidence found.')
}

main()
  .catch((err) => {
    console.error('[repair] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
