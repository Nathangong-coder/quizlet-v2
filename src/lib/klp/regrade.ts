/**
 * Re-grading stored answers against a card's NEW key points — the planner.
 *
 * Design: `docs/superpowers/specs/2026-09-07-klp-quality-pipeline-design.md`,
 * revision R1 and build order item 2.
 *
 * ## Why this exists before any auto-fix
 *
 * Every hygiene auto-fix — split, rewrite, merge, retag, delete — supersedes a
 * `CardKlp`. `writeKlpVersion` stamps `supersededAt` on the old rows and writes
 * new ones with NEW IDS. `AnswerKlpResult` points at the old ids, so the
 * learner's evidence is still there but is now attached to propositions nothing
 * reads: `rebuildKlpStates` replays per klpId, and the live key points have no
 * evidence at all. **Mastery silently resets. A typo fix already does this
 * today.** Running a quality pass over a live corpus would do it at scale, in
 * the name of quality, invisibly.
 *
 * An earlier draft proposed gating hygiene behind publication. The owner
 * rejected that and was right: people edit cards constantly and would route
 * around a publish step. So the edit lands immediately and **the evidence
 * catches up in the background** — which is what this plans.
 *
 * ## No queue table, and no new column
 *
 * "Has this answer been graded against the current key points?" is answerable
 * from rows that already exist: does every one of its `AnswerKlpResult` rows
 * point at a LIVE `CardKlp`? If yes there is nothing stranded and the answer is
 * skipped. That check is also the work queue — an answer needing re-grading is
 * exactly one with evidence on a superseded version — so no table, no status
 * column, and no way for a queue to drift out of sync with reality.
 *
 * The check matters because **re-grading is not deterministic**: the same
 * grader on the same answer can return a different verdict. Without the gate, a
 * job that ran twice would churn every posterior for no new information.
 *
 * ## The one thing that must never happen
 *
 * MULTIPLE CHOICE AND TRUE/FALSE CANNOT BE RE-GRADED. Their diagnosis does not
 * come from text; it comes from distractor provenance — `QuizQuestion.options`
 * carries `sourceKlpId` + `corruption` per option, pinned to a `klpVersion`. A
 * distractor was GENERATED to corrupt a key point that no longer exists, so the
 * learner's wrong pick diagnosed that point and there is no honest mapping onto
 * a new one. `selectedOption` text survives, but asking a model which new key
 * point it meant is inference presented as provenance — a fabricated
 * observation, indistinguishable in the database from a real one, in a real
 * learner's history. **So their evidence is carried forward where the
 * proposition survived verbatim and dropped where it did not. Never inferred.**
 *
 * ## Carrying forward is exact-text only
 *
 * A proposition survives a re-authoring when its TEXT survives. That is the
 * only identity available — ids are new by construction — and anything looser
 * (embedding distance, a model asked "is this the same point?") is the same
 * inference the paragraph above forbids, just with a friendlier name.
 * `normalizeKlpText` collapses whitespace and case, so a typo fix or a
 * reformat still counts as the same proposition; nothing beyond that is
 * matched. Ambiguity is refused rather than guessed — see `buildCarryMap`.
 */
import type { KlpStatus } from '@/lib/errors/klp-credit'
import type { StudySource } from '@/lib/memory/scoring'
import type { AnalysisOutcome, AnalysisWarning } from '@/lib/analysis/persist'

/**
 * Modes that can honestly be re-graded — and the test is NOT "is the answer
 * free text". It is **what was the answer asked about?**
 *
 * `quiz-sa` qualifies because its prompt IS the card: the learner was asked to
 * answer the whole thing, so the whole live key-point set is the right scope
 * and `GRADE_SHORT_ANSWER_PROMPT` judging every point is exactly correct.
 */
export const REGRADABLE_MODES: readonly StudySource[] = ['quiz-sa']

/**
 * Modes that may only be carried forward or dropped.
 *
 * Listed explicitly rather than derived as "everything else" so that adding a
 * graded mode forces a decision about which side it falls on.
 *
 * `quiz-mc` / `quiz-tf` — diagnosis is distractor provenance pinned to a dead
 * `klpVersion`; there is no honest mapping from a wrong pick to a new point.
 *
 * **`diagnostic` — MOVED HERE 2026-09-08 after it corrupted real history.**
 * A diagnostic answer is free text, so the first version of this module filed
 * it as re-gradable. That was wrong, and the reason is scope, not format: a
 * diagnostic question probes EXACTLY ONE key point (`DiagnosticQuestion.klpId`
 * — "only what it asked was credited" is true by construction), while
 * `GRADE_SHORT_ANSWER_PROMPT` judges the answer against the card's WHOLE set.
 *
 * Re-grading one therefore invents evidence about points the learner was never
 * asked about, and it is not neutral — it is overwhelmingly NEGATIVE, because
 * an answer to one question does not mention the other five. Measured on the
 * live database: a learner asked "what is Revenue minus COGS?" answered "Gross
 * Profit", correctly, and was recorded as having FAILED four key points on
 * operating expenses, EBIT, EBITDA and net income. Five answers were corrupted
 * this way before it was caught.
 *
 * The scope a diagnostic answer could honestly be re-graded against is its one
 * probed key point — and if that point did not survive verbatim there is
 * nothing to grade against, which is the same position MC/TF are in. So it
 * carries forward or it drops.
 */
export const CARRY_ONLY_MODES: readonly StudySource[] = ['quiz-mc', 'quiz-tf', 'diagnostic']

export function isRegradableMode(mode: string): boolean {
  return (REGRADABLE_MODES as readonly string[]).includes(mode)
}

/**
 * The identity used to decide a proposition survived.
 *
 * Whitespace collapse and case folding ONLY. Re-wrapping a key point or fixing
 * its capitalisation is not a change to the claim, and treating it as one would
 * drop real evidence on every cosmetic edit — the exact failure this module
 * exists to prevent. Anything semantic is out of bounds.
 */
export function normalizeKlpText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface LiveKlp {
  id: string
  text: string
}

/**
 * normalized text -> live KLP id, with ambiguity REMOVED rather than resolved.
 *
 * Two live key points that normalize to the same string are a duplicate-point
 * hygiene defect, and carrying evidence onto whichever one happened to be
 * written second would be a coin flip recorded as a fact. So the key is dropped
 * from the map: the prior evidence fails to match, is reported as dropped, and
 * a human sees a real number instead of a silent guess.
 */
export function buildCarryMap(live: LiveKlp[]): Map<string, string> {
  const seen = new Map<string, string | null>()
  for (const k of live) {
    const key = normalizeKlpText(k.text)
    seen.set(key, seen.has(key) ? null : k.id)
  }
  const out = new Map<string, string>()
  for (const [key, id] of seen) if (id !== null) out.set(key, id)
  return out
}

/** An existing `AnswerKlpResult`, plus the text of the key point it points at. */
export interface PriorResult {
  klpId: string
  klpText: string
  status: KlpStatus
  mode: StudySource
  credit: number
  evidence?: string | null
  /** Whether its key point is still live (not superseded). */
  isLive: boolean
}

export interface CarriedResult {
  fromKlpId: string
  toKlpId: string
  status: KlpStatus
  mode: StudySource
  /** Unchanged: `credit` is statusCredit x evidenceStrength(mode), and neither moved. */
  credit: number
  evidence?: string | null
}

export type RegradeAction =
  /** Every result already points at a live key point. Nothing stranded. */
  | 'skip'
  /** Every result carried forward verbatim. NO AI CALL — the typo-fix path. */
  | 'remap'
  /** Some carried, some dropped. No AI call (carry-only mode, or nothing new). */
  | 'carry_partial'
  /** Nothing survived. All evidence dropped. */
  | 'drop_all'
  /** Free-text answer, and the live set has points no carried evidence covers. */
  | 'regrade'

export interface RegradePlan {
  answerId: string
  mode: StudySource
  action: RegradeAction
  carried: CarriedResult[]
  /** Key point ids whose evidence is discarded — their proposition is gone. */
  droppedKlpIds: string[]
  /** Live key points no carried evidence speaks to. */
  uncoveredKlpIds: string[]
  /** What `QuizAnswer.analysisStatus` should read afterwards. */
  status: AnalysisOutcome
  warnings: AnalysisWarning[]
}

export interface PlanInput {
  answerId: string
  mode: StudySource
  /** `QuizAnswer.answer`. Null/empty means there is no text to re-grade. */
  answerText: string | null
  priorResults: PriorResult[]
  live: LiveKlp[]
}

/**
 * Decides what happens to ONE stored answer. Pure — every branch, every
 * dropped row, and the resulting `analysisStatus` are decided here, so the
 * executor only writes.
 *
 * The ordering of the branches is load-bearing and is the whole contract:
 *
 *  1. **Skip** when nothing is stranded. The idempotency gate, and the reason
 *     re-running the job is free rather than destructive.
 *  2. **Carry forward** everything whose proposition survived verbatim.
 *  3. **Re-grade** only a free-text answer, and only when the live set has
 *     points the carried evidence does not cover. A card whose points merely
 *     got renumbered costs nothing.
 *  4. **Never infer.** Anything not carried is dropped and counted.
 */
export function planAnswerRegrade(input: PlanInput): RegradePlan {
  const warnings: AnalysisWarning[] = []

  // A card with no live key points has nothing to map onto. Dropping the
  // evidence here would be right in a sense, but this is reached whenever a
  // card is mid-authoring or its extraction failed, and destroying history on a
  // transient state is not recoverable. Leave it alone; the next run with real
  // key points will carry it forward.
  if (input.live.length === 0) {
    return {
      answerId: input.answerId,
      mode: input.mode,
      action: 'skip',
      carried: [],
      droppedKlpIds: [],
      uncoveredKlpIds: [],
      status: 'no_klps',
      warnings: [{ reason: 'card_has_no_live_klps', value: input.answerId }],
    }
  }

  // THE IDEMPOTENCY GATE. Re-grading is not deterministic, so an answer whose
  // evidence is already entirely on live key points must not be touched — a
  // second run would otherwise churn every posterior for no new information.
  const stranded = input.priorResults.filter((r) => !r.isLive)
  if (input.priorResults.length > 0 && stranded.length === 0) {
    return {
      answerId: input.answerId,
      mode: input.mode,
      action: 'skip',
      carried: [],
      droppedKlpIds: [],
      uncoveredKlpIds: [],
      status: 'analyzed',
      warnings: [],
    }
  }

  const carryMap = buildCarryMap(input.live)
  const carried: CarriedResult[] = []
  const droppedKlpIds: string[] = []
  // `AnswerKlpResult` is unique on (quizAnswerId, klpId), so two priors landing
  // on one live point would violate the constraint. It can happen legitimately:
  // a merge collapses two old points into one whose text matches neither, or a
  // duplicate existed on the old version. First writer wins and the second is
  // dropped with a warning — picking between two verdicts for one proposition
  // is a judgment nothing here is entitled to make.
  const claimed = new Set<string>()

  for (const prior of input.priorResults) {
    const target = carryMap.get(normalizeKlpText(prior.klpText))
    if (target === undefined) {
      droppedKlpIds.push(prior.klpId)
      continue
    }
    if (claimed.has(target)) {
      droppedKlpIds.push(prior.klpId)
      warnings.push({ reason: 'duplicate_carry_target', value: prior.klpId })
      continue
    }
    claimed.add(target)
    carried.push({
      fromKlpId: prior.klpId,
      toKlpId: target,
      status: prior.status,
      mode: prior.mode,
      credit: prior.credit,
      evidence: prior.evidence ?? null,
    })
  }

  const uncoveredKlpIds = input.live.map((k) => k.id).filter((id) => !claimed.has(id))

  const hasText = (input.answerText ?? '').trim().length > 0
  const canRegrade = isRegradableMode(input.mode) && hasText

  if (uncoveredKlpIds.length > 0 && canRegrade) {
    // The AI call supersedes the carried entries rather than merging with them:
    // the grader judges the WHOLE live set in one call and returns a verdict per
    // point, so keeping some carried verdicts beside its output would mix two
    // graders' judgments inside one answer's evidence. Costs a few re-judged
    // points that had not changed; buys one grader per answer.
    return {
      answerId: input.answerId,
      mode: input.mode,
      action: 'regrade',
      carried,
      droppedKlpIds,
      uncoveredKlpIds,
      status: 'analyzed',
      warnings,
    }
  }

  if (uncoveredKlpIds.length > 0 && isRegradableMode(input.mode) && !hasText) {
    warnings.push({ reason: 'no_answer_text_to_regrade', value: input.answerId })
  }
  if (uncoveredKlpIds.length > 0 && !isRegradableMode(input.mode)) {
    // NOT a failure. MC/TF diagnosis is distractor provenance pinned to a dead
    // version; there is no honest mapping, and inventing one is the fabrication
    // this engine refuses everywhere.
    warnings.push({ reason: 'mode_cannot_be_regraded', value: input.mode })
  }

  const action: RegradeAction =
    carried.length === 0 ? 'drop_all' : droppedKlpIds.length === 0 ? 'remap' : 'carry_partial'

  return {
    answerId: input.answerId,
    mode: input.mode,
    action,
    carried,
    droppedKlpIds,
    uncoveredKlpIds,
    // Zero surviving evidence on a card that HAS live key points is exactly
    // what `no_provenance` means — analysed and unattributable, as opposed to
    // analysed and clean. Both are zero rows, and Spec 3's error rates need a
    // denominator of genuinely analysed answers or a legacy-heavy corpus reads
    // as a better learner.
    status: carried.length === 0 ? 'no_provenance' : 'analyzed',
    warnings,
  }
}

export interface RegradeTotals {
  answers: number
  skipped: number
  remapped: number
  carriedPartial: number
  droppedAll: number
  regraded: number
  resultsCarried: number
  resultsDropped: number
  /** Answers needing an AI call — the only part of the job that costs money. */
  aiCalls: number
}

export function summarizeRegrade(plans: RegradePlan[]): RegradeTotals {
  const t: RegradeTotals = {
    answers: plans.length,
    skipped: 0,
    remapped: 0,
    carriedPartial: 0,
    droppedAll: 0,
    regraded: 0,
    resultsCarried: 0,
    resultsDropped: 0,
    aiCalls: 0,
  }
  for (const p of plans) {
    if (p.action === 'skip') t.skipped += 1
    if (p.action === 'remap') t.remapped += 1
    if (p.action === 'carry_partial') t.carriedPartial += 1
    if (p.action === 'drop_all') t.droppedAll += 1
    if (p.action === 'regrade') {
      t.regraded += 1
      t.aiCalls += 1
    }
    if (p.action !== 'skip' && p.action !== 'regrade') t.resultsCarried += p.carried.length
    t.resultsDropped += p.action === 'skip' ? 0 : p.droppedKlpIds.length
  }
  return t
}

/**
 * Cards per background re-grade sweep.
 *
 * Higher than the authoring batch because a card is usually FREE here: pure
 * carry-forward costs zero AI calls, and only a short-answer whose live set
 * gained a point needs one. The cap exists for the worst case, not the normal
 * one.
 */
export const REGRADE_CARDS_PER_RUN = 10

/**
 * Wall-clock budget for the sweep, well under the authoring run's.
 *
 * The sweep runs FIRST (see the cron route) so repair cannot be starved by
 * authoring, and this bound is what stops that priority from inverting: a
 * backlog of re-gradable answers must not consume the whole invocation and
 * leave nothing authored.
 */
export const REGRADE_BUDGET_MS = 60_000
