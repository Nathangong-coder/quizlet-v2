import type { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { WRITE_FORM_REQS_PROMPT } from '@/lib/ai/prompts/write-form-reqs'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { FormRequirementsSchema, ShortAnswerGradeSchema } from '@/lib/ai/schemas'

/**
 * FORM REQUIREMENTS — the authoring pass (Spec 5 §5, 2026-09-17).
 *
 * A form requirement is a SHAPE rule an answer must satisfy — answers the
 * question asked, states direction and magnitude, in causal order, closes
 * the loop — as distinct from the CONTENT the key points require. They exist
 * for the failure every content metric misses: a fluent answer that covers
 * six of seven points of a slightly different question, which is the
 * memorised-template trap by construction.
 *
 * SEPARATE PASS, NEVER A RE-AUTHOR. One call per card over what authoring
 * already produced — `CardAuthoring.referenceAnswer` and the live `CardKlp`
 * rows — writing `CardFormRequirement` rows at the card's current
 * `klpVersion`. Nothing here touches the key points, the authoring row, or
 * the card's `klpStatus`; a card with no authoring at its version is
 * SKIPPED (`no_authoring`), not drafted, because a reference answer written
 * here would be a second, untested authoring path.
 *
 * VERSIONED WITH THE KLPs. Rows carry `klpVersion`; a re-authored card
 * (new `klpVersion`) has no rows at the new version and needs the pass
 * again, and its stale rows are simply never read (`planFormReqs`,
 * `build-set.ts`). Resumable by the same rule: rows at the current version
 * mean skip.
 *
 * THE WEAK CHECK. After the write, the stored `memorized_template` probe
 * (`AuthoringProbe`, the trap that answers fluently and beside the point) is
 * graded ONCE through the runtime grader — `GRADE_SHORT_ANSWER_PROMPT`, the
 * instrument that will grade learners — with the new requirements listed.
 * `weak` is true when the trap MEETS EVERY ONE of them: requirements the
 * template passes are not doing their job. It is reported, never retried
 * and never persisted (a `weak` column is Phase B's call if the rate
 * warrants it); the requirements stay written either way, because a
 * flagged card is more useful than a silently retried one — the same rule
 * `low_discrimination` follows in authoring.
 *
 * The grader needs a non-empty key-point list to emit its analysis body at
 * all, so the live KLPs ride along in the weak-check prompt and ONLY
 * `formResults` is read from the reply.
 */

/**
 * One structured call. `model` is the model that SERVED the value — every
 * row persists it, so the in-app adapter must be `generateJsonWithMeta`, not
 * `generateJson` (`src/lib/klp/generators.ts`); a script's `--direct`
 * adapter reports the combo's model.
 */
export type FormReqGen = <T>(prompt: string, schema: z.ZodSchema<T>) => Promise<{ value: T; model: string }>

/** The two fields the plan reads; a build-set row or a script row both fit. */
export interface FormReqPlanCard {
  id: string
  klpVersion: number
  /** `klpVersion` of every `CardFormRequirement` row the card has, any version. */
  formReqVersions: number[]
}

/**
 * Which cards need the pass: those with NO requirement rows at their current
 * `klpVersion`. Pure. Rows at an older version do not count — the card was
 * re-authored since, and the shape rules were written for points that no
 * longer exist.
 */
export function planFormReqs<C extends FormReqPlanCard>(cards: C[]): C[] {
  return cards.filter((c) => !c.formReqVersions.includes(c.klpVersion))
}

export interface FormReqOutcome {
  /** Rows written this call. 0 when skipped. */
  written: number
  /** The memorised-template trap met every requirement. Never true unless `probeChecked`. */
  weak: boolean
  /** The weak check ran (the authoring stored a `memorized_template` probe). */
  probeChecked: boolean
  /** Why nothing was written, when nothing was. */
  skipped?: 'exists' | 'no_authoring' | 'no_klps'
  /** The model that wrote the requirements, when any were written. */
  model?: string
  /** Every requirement as written, for the per-card log line. */
  requirements: string[]
}

export const MEMORIZED_TEMPLATE_KIND = 'memorized_template'

/**
 * Authors one card's form requirements and runs the weak check. See the
 * module comment for every rule; the outcome says what happened and the
 * caller (script, build step) decides what to print or record.
 */
export async function authorFormRequirements(cardId: string, gen: FormReqGen, opts: { log?: (line: string) => void } = {}): Promise<FormReqOutcome> {
  const log = opts.log ?? (() => undefined)
  // The whole row: the weak check hands the grader's `build` a `Card`.
  const card = await prisma.card.findUnique({ where: { id: cardId } })
  if (!card) throw new Error(`[form-reqs] no card ${cardId}`)

  const none = (skipped: FormReqOutcome['skipped']): FormReqOutcome => ({ written: 0, weak: false, probeChecked: false, skipped, requirements: [] })

  // Resumable: rows at the CURRENT version mean this card is done.
  const existing = await prisma.cardFormRequirement.count({ where: { cardId, klpVersion: card.klpVersion } })
  if (existing > 0) return none('exists')

  const klps = await prisma.cardKlp.findMany({
    where: { cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { text: true, kind: true },
  })
  if (klps.length === 0) return none('no_klps')

  // The authoring AT THIS VERSION — an older run's reference answer describes
  // points that were since superseded. Latest first in case a version was
  // authored twice (a re-run after a failure).
  const authoring = await prisma.cardAuthoring.findFirst({
    where: { cardId, klpVersion: card.klpVersion },
    orderBy: { createdAt: 'desc' },
    select: { referenceAnswer: true, probes: { where: { kind: MEMORIZED_TEMPLATE_KIND }, select: { text: true } } },
  })
  if (!authoring) return none('no_authoring')

  const { value, model } = await gen(
    WRITE_FORM_REQS_PROMPT.build({ question: card.term, definition: card.definition, referenceAnswer: authoring.referenceAnswer, klps }),
    FormRequirementsSchema,
  )
  const requirements = value.requirements.map((r) => r.text.trim())

  const rows: Prisma.CardFormRequirementCreateManyInput[] = requirements.map((text, index) => ({
    cardId,
    klpVersion: card.klpVersion,
    index,
    text,
    promptVersion: WRITE_FORM_REQS_PROMPT.version,
    model,
  }))
  await prisma.cardFormRequirement.createMany({ data: rows })
  log(`[form-reqs] ${cardId}: wrote ${rows.length} requirement(s) at v${card.klpVersion} (${model})`)

  // ── the weak check ────────────────────────────────────────────────────────
  const probe = authoring.probes[0]
  if (!probe) {
    log(`[form-reqs] ${cardId}: no memorized_template probe stored — weak check skipped`)
    return { written: rows.length, weak: false, probeChecked: false, model, requirements }
  }

  const grade = await gen(
    GRADE_SHORT_ANSWER_PROMPT.build({
      card,
      answer: probe.text,
      klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
      formReqs: requirements.map((text, ref) => ({ ref, text })),
      referenceAnswer: authoring.referenceAnswer,
    }),
    ShortAnswerGradeSchema,
  )
  // Weak only on an EXPLICIT `met` for every rule. A grader that omits a rule
  // has not said the trap satisfies it, and `[].every` would say it had.
  const results = grade.value.formResults ?? []
  const weak = requirements.every((_, ref) => results.find((r) => r.formRef === ref)?.status === 'met')
  const met = requirements.filter((_, ref) => results.find((r) => r.formRef === ref)?.status === 'met').length
  log(`[form-reqs] ${cardId}: the template trap met ${met}/${requirements.length} requirement(s)${weak ? ' — WEAK: the trap should fail at least one' : ''}`)

  return { written: rows.length, weak, probeChecked: true, model, requirements }
}
