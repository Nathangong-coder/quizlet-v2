import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateText, Output, NoObjectGeneratedError } from 'ai'
import type { z } from 'zod'
import type { Card, Prisma } from '@prisma/client'
import { prisma } from '../src/lib/db'
import { generateJsonWithMeta } from '../src/lib/ai/generate'
import type { AiTask } from '../src/lib/ai/model-routing'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { temperatureForTask } from '../src/lib/ai/temperature'
import { readDirectPool, comboResolveInput, poolStatus, type DirectCombo } from '../src/lib/klp/direct-pool'
import { Pacer, callWithPacingAndRetry, realClock, rpmToIntervalMs, DEFAULT_RPM } from '../src/lib/klp/authoring-pacing'
import { TokenMeter } from '../src/lib/klp/token-meter'
import { GRADE_SHORT_ANSWER_PROMPT } from '../src/lib/ai/prompts/grade-short-answer'
import { SUPERVISE_DEFINITION_PROMPT } from '../src/lib/ai/prompts/supervise-definition'
import { ShortAnswerGradeWithAnalysisSchema, type DefinitionSupervision } from '../src/lib/ai/schemas'
import { loadGradingContext, promptViewOf } from '../src/lib/quiz/grading-context'
import { gradeMaxOutputTokens } from '../src/lib/analysis/output-cap'
import { GRADER_VERSION } from '../src/lib/analysis/version'
import { RUBRIC_VERSION } from '../src/lib/analysis/rubric'
import {
  DEFINITION_PASS,
  DEFINITION_HARD_FAIL,
  MAX_PROBE_ROUNDS,
  SUPERVISION_PASSES,
  probeOutcome,
  scoreDefinition,
  supervisionDecision,
  findingsFromSupervision,
  findingsFromHardFail,
  formatProbeLine,
  loadBearingIndexes,
  applyLoadBearing,
  type DefinitionScore,
  type RevisionFinding,
  type SupervisionPoint,
} from '../src/lib/klp/definition-probe'

/**
 * `npm run probe-definitions -- --set <setId> [--direct] [--model <id>] [--supervise] [--revise] [--rounds <n>] [--cards <a,b>] [--dry-run] [--rpm <n>]`
 *
 * THE DEFINITION PROBE — does the card's OWN definition pass the key points
 * authored for it? For every card with live key points, the owner's
 * definition is graded through the REAL runtime grader (the same prompt,
 * context and ceiling a quiz answer gets, plus the note-form clause: a terse
 * note is graded on the knowledge it holds, not its prose). TypeScript scores
 * it (`scoreDefinition`) and files one `DefinitionProbe` row per
 * (card, klpVersion, graderVersion, promptVersion) — resumable: a card already
 * probed at its current versions is read back, never re-graded.
 *
 * Thresholds (`src/lib/klp/definition-probe.ts`): >= DEFINITION_PASS passes;
 * < DEFINITION_HARD_FAIL goes straight to revision with the probe's own
 * omissions as findings; between, `--supervise` asks a supervising model to
 * rule point by point (keep / narrow / cut / grader_wrong). Any narrow/cut →
 * revise; all keep on SUPERVISION_PASSES different models → ESCALATE to the
 * set author (printed here, `decision: 'escalate'` on the row).
 *
 * `--revise` re-authors the cards decided `revise` by spawning
 * `scripts/author-klps.ts --cards <ids> --force --findings <file>` — the whole
 * pipeline (traps, separation, relations, weights, panel reuse) runs on the
 * findings-aware v6 prompt — then re-probes at the new klpVersion. Up to
 * `--rounds` (default MAX_PROBE_ROUNDS) rounds; a card still failing is left
 * with its last row and named at the end.
 *
 * Supervisors on `--direct`: pass 1 on the grade pool's provider with
 * KLP_SUPERVISE_MODEL (default `deepseek-v4-pro` — a stronger model of the
 * grader's family, reasoning off); pass 2 on the AUTHOR pool (GLM at high — a
 * different family, and the one that wrote the points, which is why it goes
 * second). A card with live learner evidence (`KlpState`) is never revised
 * from here: superseding its points would reset mastery. It is reported.
 */
const USAGE = `usage: probe-definitions --set <setId> [options]
  --direct             raw env keys (KLP_DIRECT_* grader; KLP_AUTHOR_* second supervisor) instead of the owner's stored credentials
  --model <id>         pin the grading model (required for a comparable record on a multi-model pool)
  --supervise          run the supervising pass(es) on cards between the thresholds
  --revise             re-author cards decided 'revise' and re-probe them (implies --supervise)
  --rounds <n>         probe → revise → re-probe rounds (default ${MAX_PROBE_ROUNDS})
  --cards <a,b>        only these card ids
  --dry-run            print what would be probed / decided; call nothing, write nothing
  --rpm <n>            pacing for --direct (default ${DEFAULT_RPM})`

const METER = new TokenMeter()

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

type Call = <T>(input: { prompt: string; schema: z.ZodSchema<T>; maxOutputTokens?: number; step: string; task: AiTask }) => Promise<{ value: T; model: string }>

function pooledCall(ownerId: string): Call {
  return async (input) => {
    const { value, meta } = await generateJsonWithMeta({ userId: ownerId, task: input.task, prompt: input.prompt, schema: input.schema, maxOutputTokens: input.maxOutputTokens })
    METER.add(input.step, meta.model, meta.usage)
    return { value, model: meta.model }
  }
}

function directCall(combo: DirectCombo, pacer: Pacer): Call {
  // Z.ai effort rides in `requestDefaults` (ZAI_REASONING_EFFORT), as in author-klps.
  const model = resolveLanguageModel(comboResolveInput(combo))
  return async (input) => {
    const value = await callWithPacingAndRetry(
      async () => {
        const attempt = () =>
          generateText({ model, prompt: input.prompt, output: Output.object({ schema: input.schema }), maxOutputTokens: input.maxOutputTokens, temperature: temperatureForTask(input.task), maxRetries: 0 })
        let res: Awaited<ReturnType<typeof attempt>>
        try {
          res = await attempt()
        } catch (err) {
          if (!NoObjectGeneratedError.isInstance(err) || err.finishReason === 'length') throw err
          console.log(`    ${combo.model}: malformed reply; retrying once in place`)
          await pacer.waitTurn()
          res = await attempt()
        }
        METER.add(input.step, combo.model, {
          inputTokens: res.usage?.inputTokens,
          outputTokens: res.usage?.outputTokens,
          reasoningTokens: res.usage?.outputTokenDetails?.reasoningTokens,
          cachedTokens: res.usage?.inputTokenDetails?.cacheReadTokens,
        })
        return res.output
      },
      { pacer, clock: realClock },
    )
    return { value, model: combo.model }
  }
}

interface CardRow {
  id: string
  term: string
  definition: string
  klpVersion: number
}

interface ProbeRow {
  id: string
  cardId: string
  klpVersion: number
  score: number
  outcome: string
  decision: string | null
  verdicts: { klpRef: number; klpId: string; status: string; quote?: string; weight: number }[]
  supervision: { pass: number; model: string; promptVersion: number; points: SupervisionPoint[]; summary: string }[]
  findings: RevisionFinding[] | null
}

async function liveKlps(cardId: string) {
  return prisma.cardKlp.findMany({
    where: { cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, index: true, text: true, kind: true, weight: true, role: true, version: true },
  })
}

/** Grade the definition once, or read the row already there at these versions. */
async function probeCard(card: CardRow, grade: Call, dryRun: boolean): Promise<{ row: ProbeRow | null; fresh: boolean; score: DefinitionScore; referenceWords: number | null; klps: Awaited<ReturnType<typeof liveKlps>> }> {
  const klps = await liveKlps(card.id)
  const probeKlps = klps.map((k) => ({ index: k.index, text: k.text, weight: k.weight, kind: k.kind }))
  const existing = await prisma.definitionProbe.findFirst({
    where: { cardId: card.id, klpVersion: card.klpVersion, graderVersion: GRADER_VERSION, promptVersion: GRADE_SHORT_ANSWER_PROMPT.version },
    orderBy: { createdAt: 'desc' },
  })
  const context = await loadGradingContext(card.id, klps)
  const referenceWords = context.referenceAnswer ? context.referenceAnswer.split(/\s+/).filter(Boolean).length : null
  if (existing) {
    const row = readRow(existing)
    return { row, fresh: false, score: scoreDefinition(row.verdicts, probeKlps), referenceWords, klps }
  }
  if (dryRun) {
    return { row: null, fresh: false, score: scoreDefinition([], probeKlps), referenceWords, klps }
  }
  const { promptRelations, promptFormReqs } = promptViewOf(klps, context)
  const promptKlps = klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind }))
  const prompt = GRADE_SHORT_ANSWER_PROMPT.build({
    card: card as unknown as Card,
    answer: card.definition,
    klps: promptKlps,
    relations: promptRelations.length ? promptRelations : undefined,
    formReqs: promptFormReqs.length ? promptFormReqs : undefined,
    referenceAnswer: context.referenceAnswer ?? undefined,
    noteForm: true,
  })
  const { value: g, model } = await grade({
    prompt,
    schema: ShortAnswerGradeWithAnalysisSchema,
    maxOutputTokens: gradeMaxOutputTokens(promptKlps.length + promptRelations.length + promptFormReqs.length),
    step: 'probe',
    task: 'grade',
  })
  const verdicts = g.klpResults.map((v) => ({ klpRef: v.klpRef, klpId: klps[v.klpRef]?.id ?? '', status: v.status, quote: v.quote, weight: klps[v.klpRef]?.weight ?? 0 })).filter((v) => v.klpId)
  const score = scoreDefinition(verdicts, probeKlps)
  const outcome = probeOutcome(score.score)
  const created = await prisma.definitionProbe.create({
    data: {
      cardId: card.id,
      klpVersion: card.klpVersion,
      graderVersion: GRADER_VERSION,
      promptVersion: GRADE_SHORT_ANSWER_PROMPT.version,
      rubricVersion: RUBRIC_VERSION,
      model,
      score: score.score,
      verdicts: verdicts as unknown as Prisma.InputJsonValue,
      outcome,
      // A hard fail is decided here, from the probe alone.
      ...(outcome === 'hard_fail' ? { decision: 'revise', findings: findingsFromHardFail(score, probeKlps) as unknown as Prisma.InputJsonValue } : {}),
      ...(outcome === 'pass' ? { decision: 'none' } : {}),
    },
  })
  return { row: readRow(created), fresh: true, score, referenceWords, klps }
}

function readRow(r: { id: string; cardId: string; klpVersion: number; score: number; outcome: string; decision: string | null; verdicts: unknown; supervision: unknown; findings: unknown }): ProbeRow {
  return {
    id: r.id,
    cardId: r.cardId,
    klpVersion: r.klpVersion,
    score: r.score,
    outcome: r.outcome,
    decision: r.decision,
    verdicts: (r.verdicts as ProbeRow['verdicts']) ?? [],
    supervision: (r.supervision as ProbeRow['supervision']) ?? [],
    findings: (r.findings as RevisionFinding[] | null) ?? null,
  }
}

/**
 * Which points on the live version SEPARATE a wrong answer (the reference
 * passes them, some trap fails them), read off the stored authoring — the
 * supervisor is told, and TypeScript refuses to narrow or cut them.
 */
async function loadBearingFor(cardId: string, klpVersion: number): Promise<Set<number>> {
  const a = await prisma.cardAuthoring.findFirst({ where: { cardId, klpVersion }, orderBy: { createdAt: 'desc' }, include: { probes: { select: { verdicts: true } } } })
  if (!a || !a.referenceVerdicts) return new Set()
  return loadBearingIndexes(a.referenceVerdicts as string[], a.probes.map((p) => p.verdicts as Record<string, string>))
}

/** One supervising pass; returns the points (load-bearing narrow/cut read as keep) and persists them on the row. */
async function supervise(row: ProbeRow, card: CardRow, klps: Awaited<ReturnType<typeof liveKlps>>, referenceAnswer: string | null, call: Call, pass: number, loadBearing: ReadonlySet<number>): Promise<SupervisionPoint[]> {
  const prompt = SUPERVISE_DEFINITION_PROMPT.build({
    question: card.term,
    definition: card.definition,
    referenceAnswer,
    klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind, weight: k.weight, loadBearing: loadBearing.has(ref) })),
    graderVerdicts: row.verdicts.map((v) => ({ ref: v.klpRef, status: v.status, quote: v.quote })),
    score: Math.round(row.score * 100),
  })
  const { value, model } = await call({ prompt, schema: SUPERVISE_DEFINITION_PROMPT.schema, maxOutputTokens: 4096, step: `supervise-${pass}`, task: 'klp-extract' })
  const reply = value as DefinitionSupervision
  const raw: SupervisionPoint[] = reply.points
    .filter((p) => p.klpRef >= 0 && p.klpRef < klps.length)
    .map((p) => ({ klpRef: p.klpRef, verdict: p.verdict, reason: p.reason, wording: p.wording ?? undefined }))
  const { points, overridden } = applyLoadBearing(raw, loadBearing)
  row.supervision = [...row.supervision, { pass, model, promptVersion: SUPERVISE_DEFINITION_PROMPT.version, points, summary: reply.summary }]
  await prisma.definitionProbe.update({ where: { id: row.id }, data: { supervision: row.supervision as unknown as Prisma.InputJsonValue } })
  console.log(`  supervise #${pass} (${model}) ${card.term.slice(0, 50)} — ${points.map((p) => `[${p.klpRef}] ${p.verdict}`).join(' · ')}${overridden.length ? `  (load-bearing, held: ${overridden.map((i) => `[${i}]`).join('')})` : ''}\n    ${reply.summary}`)
  return points
}

async function main() {
  const args = process.argv.slice(2)
  if (flag(args, '--help') || flag(args, '-h')) {
    console.log(USAGE)
    return
  }
  const setId = opt(args, '--set')
  if (!setId) {
    console.error('[probe-definitions] --set <setId> is required.\n' + USAGE)
    process.exitCode = 2
    return
  }
  const direct = flag(args, '--direct')
  const modelFlag = opt(args, '--model')
  const revise = flag(args, '--revise')
  const superviseFlag = flag(args, '--supervise') || revise
  const dryRun = flag(args, '--dry-run')
  const rounds = Math.max(1, Number(opt(args, '--rounds') ?? MAX_PROBE_ROUNDS))
  const onlyIds = (opt(args, '--cards') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const rpm = Number(opt(args, '--rpm') ?? DEFAULT_RPM)

  const set = await prisma.set.findUnique({ where: { id: setId }, select: { id: true, userId: true, title: true } })
  if (!set) {
    console.error(`[probe-definitions] set ${setId} not found.`)
    process.exitCode = 1
    return
  }

  // Calls. Read even on a dry run so a missing key fails before the table.
  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock)
  let grade: Call
  let supervisor1: Call
  let supervisor2: Call
  let gradeModel = 'stored pool'
  if (direct) {
    const gradePool = readDirectPool()
    const authorPool = readDirectPool(process.env, 'author')
    const gradeCombo = (modelFlag ? gradePool.find((c) => c.model === modelFlag) : gradePool[0]) ?? gradePool[0]
    if (!gradeCombo) throw new Error('no grading combo in the direct pool')
    gradeModel = gradeCombo.model
    grade = directCall(gradeCombo, pacer)
    const superviseModel = process.env.KLP_SUPERVISE_MODEL ?? 'deepseek-v4-pro'
    supervisor1 = directCall({ ...gradeCombo, model: superviseModel }, pacer)
    const second = authorPool[0] ?? { ...gradeCombo, model: superviseModel }
    supervisor2 = directCall(second, pacer)
    console.log(`[probe-definitions] --direct: grading on ${gradeModel} (${poolStatus(gradePool).total} combo(s)); supervisor #1 ${superviseModel} (${gradeCombo.provider}); supervisor #2 ${second.model} (${second.provider})${authorPool.length ? '' : ' — no KLP_AUTHOR_* pool, second pass on the grader family'}`)
  } else {
    grade = supervisor1 = supervisor2 = pooledCall(set.userId)
    console.log(`[probe-definitions] stored credentials of the set owner; supervisors rotate on the same pool`)
  }
  console.log(`[probe-definitions] "${set.title}" — grader v${GRADER_VERSION}, prompt v${GRADE_SHORT_ANSWER_PROMPT.version}, rubric v${RUBRIC_VERSION}; pass >= ${DEFINITION_PASS}, hard fail < ${DEFINITION_HARD_FAIL}, ${SUPERVISION_PASSES} supervising passes, ${rounds} round(s)${dryRun ? ' — DRY RUN' : ''}`)

  const escalated: { card: CardRow; row: ProbeRow }[] = []
  const stillFailing: { card: CardRow; row: ProbeRow }[] = []
  const graderWrong: { card: CardRow; row: ProbeRow }[] = []
  let cardIds: string[] | null = onlyIds.length ? onlyIds : null

  for (let round = 1; round <= rounds; round++) {
    const cards: CardRow[] = await prisma.card.findMany({
      where: { setId, klpVersion: { gt: 0 }, ...(cardIds ? { id: { in: cardIds } } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, term: true, definition: true, klpVersion: true },
    })
    if (cards.length === 0) {
      console.log(`[probe-definitions] round ${round}: no authored cards to probe.`)
      break
    }
    console.log(`\n=== round ${round}: ${cards.length} card(s) ===`)
    const toRevise: { card: CardRow; row: ProbeRow; findings: RevisionFinding[] }[] = []
    let probed = 0
    let passed = 0

    for (const card of cards) {
      const { row, fresh, score, referenceWords, klps } = await probeCard(card, grade, dryRun)
      const outcome = row ? (row.outcome as ReturnType<typeof probeOutcome>) : probeOutcome(score.score)
      if (fresh) probed++
      if (!row) {
        console.log(`unprobed  def ${String(card.definition.split(/\s+/).filter(Boolean).length).padStart(3)}w  ref ${referenceWords === null ? '  -' : String(referenceWords).padStart(3)}w  ${klps.length} point(s)  ${card.term.slice(0, 70)}`)
        continue
      }
      const line = formatProbeLine({ term: card.term, score, definitionWords: card.definition.split(/\s+/).filter(Boolean).length, referenceWords, outcome })
      console.log(`${fresh ? 'graded ' : 'stored '} ${line}`)
      if (score.wrong.length) console.log(`    NOTE: the grader read the card as WRONG on ${score.wrong.map((i) => `[${i}]`).join('')} — the owner should see this: ${score.wrong.map((i) => klps[i]?.text ?? '').join(' | ')}`)
      if (outcome === 'pass') {
        passed++
        continue
      }

      // The live-evidence guard: never supersede points a learner has been measured on.
      const evidence = await prisma.klpState.count({ where: { klpId: { in: klps.map((k) => k.id) } } })
      if (evidence > 0 && revise) {
        console.log(`    ${evidence} KlpState row(s) on this card — revision would reset mastery; reported, not revised.`)
      }

      if (outcome === 'hard_fail') {
        const findings = row.findings ?? findingsFromHardFail(score, klps.map((k) => ({ index: k.index, text: k.text, weight: k.weight, kind: k.kind })))
        console.log(`    hard fail → revise with ${findings.length} finding(s): ${findings.map((f) => `[${f.index}] ${f.issue}`).join(', ')}`)
        if (evidence === 0) toRevise.push({ card, row, findings })
        continue
      }

      // Between the thresholds: supervise, unless already decided.
      if (!superviseFlag) {
        console.log(`    between the thresholds — run with --supervise to decide whose fault it is`)
        continue
      }
      if (dryRun) {
        console.log(`    would supervise (${row.supervision.length} pass(es) stored)`)
        continue
      }
      const context = await loadGradingContext(card.id, klps)
      const loadBearing = await loadBearingFor(card.id, card.klpVersion)
      const passes: SupervisionPoint[][] = row.supervision.map((s) => s.points)
      let decision = row.decision && row.decision !== 'none' ? row.decision : supervisionDecision(passes)
      const supervisors = [supervisor1, supervisor2]
      while (decision === 'second_pass' && passes.length < SUPERVISION_PASSES) {
        const call = supervisors[passes.length] ?? supervisor2
        passes.push(await supervise(row, card, klps, context.referenceAnswer, call, passes.length + 1, loadBearing))
        decision = supervisionDecision(passes)
      }
      const findings = decision === 'revise' ? findingsFromSupervision(passes.flat()) : null
      await prisma.definitionProbe.update({ where: { id: row.id }, data: { decision, ...(findings ? { findings: findings as unknown as Prisma.InputJsonValue } : {}) } })
      row.decision = decision
      row.findings = findings
      console.log(`    decision: ${decision}${findings ? ` — ${findings.map((f) => `[${f.index}] ${f.issue}`).join(', ')}` : ''}`)
      if (decision === 'revise' && findings && evidence === 0) toRevise.push({ card, row, findings })
      else if (decision === 'escalate') escalated.push({ card, row })
      else if (decision === 'grader_wrong') graderWrong.push({ card, row })
    }
    console.log(`round ${round}: ${probed} graded, ${cards.length - probed} read back, ${passed}/${cards.length} pass, ${toRevise.length} to revise, ${escalated.length} escalated, ${graderWrong.length} grader-wrong`)

    if (!revise || toRevise.length === 0 || dryRun) {
      if (toRevise.length && !revise) console.log(`[probe-definitions] ${toRevise.length} card(s) decided 'revise' — run with --revise to re-author them.`)
      break
    }
    if (round === rounds) {
      stillFailing.push(...toRevise.map(({ card, row }) => ({ card, row })))
      break
    }

    // Re-author the decided cards through the real pipeline, findings in the prompt.
    const dir = mkdtempSync(join(tmpdir(), 'probe-findings-'))
    const file = join(dir, 'findings.json')
    const byCard: Record<string, { index: number; text: string; issue: string; fix: string }[]> = {}
    for (const { card, row, findings } of toRevise) {
      const klps = await liveKlps(card.id)
      const texts = new Map(klps.map((k) => [k.index, k.text]))
      void row
      byCard[card.id] = findings.map((f) => ({ ...f, text: texts.get(f.index) ?? '' }))
    }
    writeFileSync(file, JSON.stringify(byCard, null, 2))
    const ids = toRevise.map((x) => x.card.id)
    console.log(`\n[probe-definitions] re-authoring ${ids.length} card(s) with findings (${file})…`)
    const authorArgs = ['tsx', '--conditions=react-server', '--env-file=.env', 'scripts/author-klps.ts', '--set', setId, '--cards', ids.join(','), '--force', '--keep-better', '--findings', file, ...(direct ? ['--direct'] : []), '--rpm', String(rpm)]
    const res = spawnSync('npx', authorArgs, { stdio: 'inherit', shell: true, env: process.env })
    if (res.status !== 0) {
      console.error(`[probe-definitions] author-klps exited ${res.status}; stopping after round ${round}.`)
      process.exitCode = 1
      break
    }
    cardIds = ids
  }

  if (escalated.length) {
    console.log(`\n=== ESCALATED TO THE SET AUTHOR (${escalated.length}) — ${SUPERVISION_PASSES} supervising passes held the card, not the points, at fault ===`)
    for (const { card, row } of escalated) {
      const klps = await liveKlps(card.id)
      const last = row.supervision[row.supervision.length - 1]
      const keep = last ? last.points.filter((p) => p.verdict === 'keep') : []
      console.log(`  ${card.term}\n    your definition: "${card.definition}"\n    scored ${Math.round(row.score * 100)}/100. The points it does not make, which separate a template answer — enrich the card, or accept them as they stand:`)
      for (const p of keep) console.log(`      [${p.klpRef}] ${klps[p.klpRef]?.text ?? ''}\n          — ${p.reason}`)
    }
  }
  if (graderWrong.length) {
    console.log(`\n=== GRADER TOO HARSH ON THE NOTE (${graderWrong.length}) — no point over-reaches; the supervisor says the definition makes the point. Calibration corpus, not a revision. ===`)
    for (const { card, row } of graderWrong) console.log(`  ${card.term} — ${Math.round(row.score * 100)}/100`)
  }
  if (stillFailing.length) {
    console.log(`\n=== STILL FAILING AFTER ${rounds} ROUND(S) (${stillFailing.length}) ===`)
    for (const { card, row } of stillFailing) console.log(`  ${card.term} — ${Math.round(row.score * 100)}/100 at klpVersion ${row.klpVersion}`)
  }
  console.log(`\n[probe-definitions] tokens (successful calls only; list prices):\n${METER.format(Math.max(1, new Set([...escalated, ...graderWrong, ...stillFailing].map((x) => x.card.id)).size))}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
