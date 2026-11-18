'use server'

import { z } from 'zod'
import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { generateJson, AiGenerationError, resolveTaskModel } from '@/lib/ai/generate'
import { AUTOCOMPLETE_PROMPT, EXTRACT_KLPS_PROMPT, GRADE_SHORT_ANSWER_PROMPT, HOT_SEAT_PROBE_PROMPT, MULTIPLE_CHOICE_PROMPT } from '@/lib/ai/prompts/registry'
import { CardAutocompleteSchema, HotSeatProbeSchema, KlpExtractionSchema, MultipleChoiceKlpSchema, MultipleChoiceOptionsSchema, ShortAnswerGradeWithAnalysisSchema, type ShortAnswerGrade } from '@/lib/ai/schemas'
import { parseOptionCache } from '@/lib/quiz/options'
import type { DemoConfig, DemoFeature } from '@/lib/demo/config'
import { guestContext } from '@/lib/demo/guest-context'
import { releaseCall, reserveCall, startRun, type DemoRefusal, type GuestCtx } from '@/lib/demo/guard'
import { signPoints, verifyPoints, type SignedPoints } from '@/lib/demo/signed-points'
import { loadDemoSet, type DemoCard, type DemoSet } from '@/lib/demo/demo-set'
import { EMAIL_MAX, normalizeEmail, recordInviteRequest } from '@/lib/demo/waitlist'
import { notifyOwner } from '@/lib/notify/owner'
import { planRun, fallbackOptions, type RunPlan } from '@/lib/games/gauntlet'
import { pickHotSeatCards, HOT_SEAT_MODES, type KlpVerdict, type HotSeatCard } from '@/lib/games/hot-seat'
import { accuracyOf, isHit } from '@/lib/games/grading'
import { personaForSubject, type Persona } from '@/lib/games/personas'
import { seedFromString, mulberry32, shuffle } from '@/lib/games/rng'
import { getSubject } from '@/lib/subjects/taxonomy'

/**
 * The guest demo's AI actions — the no-login public surface. Every export of
 * this 'use server' module is an endpoint any anonymous visitor can call, and
 * every AI call here bills the operator (`DEMO_AI_USER_ID`).
 *
 * The order inside every export is fixed (tests/demo/source-scan.test.ts):
 *   1. `guestContext()` — null means the demo is off; nothing else runs.
 *   2. Validate the input (Zod, with the guest caps) — `invalid`, no reservation.
 *   3. Resolve content: a card id only from the demo set (`loadDemoSet`,
 *      readable signed out); guest key points only with a valid signature.
 *      Anything else is `invalid`, no reservation.
 *   4. `reserveCall` / `startRun` — the guard's refusal is returned as is.
 *   5. `generateJson` on the operator's account. Any failure after a
 *      reservation hands it back (`releaseCall`), so the guest isn't charged.
 *
 * WRITES NOTHING. No QuizAnswer, StudyEvent, KlpState, QuizOptionCache or
 * card row; the only rows a demo call leaves are the guard's tickets, the
 * AiCallLog rows `generateJson` writes for the operator, and — from
 * `requestInvite` only, through @/lib/demo/waitlist — an InviteRequest row.
 */

type DemoReason = DemoRefusal | 'invalid' | 'ai_failed' | 'rate_limited'
export type DemoResult<T> = { ok: true; data: T } | { ok: false; reason: DemoReason; message: string }
type DemoFailure = Extract<DemoResult<never>, { ok: false }>

const MESSAGES: Record<DemoReason, string> = {
  demo_off: 'The demo is switched off right now.',
  demo_cap: 'The demo is busy today.',
  quota_used: "You've used this in the demo.",
  run_not_started: 'Start the game first.',
  invalid: "The demo can't do that.",
  ai_failed: 'The demo is having trouble. Try again.',
  rate_limited: 'Too many requests from here today. Try again tomorrow.',
}

function fail(reason: DemoReason): DemoFailure {
  return { ok: false, reason, message: MESSAGES[reason] }
}

const DEMO_TITLE = 'My demo cards'

// ------------------------------------------------------------------ inputs

const Id = z.string().min(1).max(64)
const Term = z.string().trim().min(1).max(200)
const Definition = z.string().trim().min(1).max(1000)
const Answer = z.string().trim().min(1).max(2000)
const GuestCard = z.object({ term: Term, definition: Definition })

const GradeInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('demo'), cardId: Id, answer: Answer }),
  // `points` is checked by verifyPoints, which parses it itself.
  z.object({ kind: z.literal('guest'), card: GuestCard, points: z.unknown(), answer: Answer }),
])
const ExtractInput = z.object({ card: GuestCard })
const Ask = z.enum(['term', 'definition'])
const GameAnswerOpts = z.object({ klpIds: z.array(Id).min(1).max(20).optional() }).optional()
const PersonaInput = z.object({
  id: z.string().max(100),
  name: z.string().max(200),
  vibe: z.string().max(1000),
  opening: z.string().max(1000),
  probeStyle: z.string().max(1000),
})
const AutocompleteInput = z.object({
  currentText: z.string().max(500),
  side: z.enum(['term', 'definition']),
  referenceText: z.string().max(500).optional(),
  cards: z.array(z.object({ term: z.string().max(200), definition: z.string().max(1000) })).max(5),
})
const InviteInput = z.object({
  email: z.string().trim().max(EMAIL_MAX),
  note: z.string().trim().max(200).optional(),
})

// ----------------------------------------------------------------- helpers

/** The guest context, its config narrowed to what an enabled demo always has (guestContext already requires it). */
type LiveCtx = GuestCtx & { config: DemoConfig & { aiUserId: string; secret: string; setId: string } }
function live(ctx: GuestCtx | null): LiveCtx | null {
  if (!ctx) return null
  const { aiUserId, secret, setId } = ctx.config
  return aiUserId && secret && setId ? (ctx as LiveCtx) : null
}

/** A schema-valid reply the demo cannot use (e.g. an extraction with no card). */
class UnusableReply extends Error {}

function logUnexpected(where: string, error: unknown) {
  if (error instanceof AiGenerationError || error instanceof UnusableReply) return
  console.error(`${where} error:`, error)
}

/** Hand a reservation back. A failed release is logged, never thrown: the guest still gets `ai_failed`. */
async function release(ticketId: string, feature: DemoFeature) {
  try {
    await releaseCall(ticketId, feature)
  } catch (error) {
    console.error('demo releaseCall error:', error)
  }
}

/**
 * Runs the AI step of a reserved call. Any throw — a provider failure, an
 * unusable reply, a bug — releases the reservation and answers `ai_failed`.
 */
async function spend<T>(ticketId: string, feature: DemoFeature, where: string, step: () => Promise<T>): Promise<DemoResult<T>> {
  try {
    return { ok: true, data: await step() }
  } catch (error) {
    await release(ticketId, feature)
    logUnexpected(where, error)
    return fail('ai_failed')
  }
}

function findDemoCard(set: DemoSet, cardId: string): DemoCard | null {
  return set.cards.find((c) => c.id === cardId) ?? null
}

/**
 * Per-point verdicts from the grader's reply, by prompt ref; a point it skipped is `failed`.
 * Callers validate with ShortAnswerGradeWithAnalysisSchema, so a reply with NO
 * verdicts fails inside `spend` (released, `ai_failed`) instead of spending
 * the guest's grade on an all-failed result.
 */
function verdictsFrom(grade: ShortAnswerGrade, points: { id: string; text: string; weight: number }[]): KlpVerdict[] {
  const byRef = new Map((grade.klpResults ?? []).map((r) => [r.klpRef, r.status]))
  return points.map((p, ref) => ({ klpId: p.id, text: p.text, weight: p.weight, status: byRef.get(ref) ?? 'failed' }))
}

// ----------------------------------------------------------------- actions

/**
 * One short-answer grade (feature `grade`). A demo card grades against its
 * live key points; a guest card against points the server generated and
 * signed (`demoExtractPoints`) — forged or edited points are `invalid`.
 */
export async function demoGrade(
  input: { kind: 'demo'; cardId: string; answer: string } | { kind: 'guest'; card: { term: string; definition: string }; points: SignedPoints; answer: string },
): Promise<DemoResult<{ grade: ShortAnswerGrade; verdicts: KlpVerdict[]; accuracy: number; generatedPoints: boolean }>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  const parsed = GradeInput.safeParse(input)
  if (!parsed.success) return fail('invalid')
  const req = parsed.data

  let card: { term: string; definition: string }
  let points: { id: string; text: string; weight: number; kind: string }[]
  if (req.kind === 'demo') {
    const set = await loadDemoSet(ctx.config.setId)
    const demoCard = set ? findDemoCard(set, req.cardId) : null
    if (!demoCard) return fail('invalid')
    card = demoCard
    points = demoCard.klps
  } else {
    const verified = verifyPoints(req.card, req.points, ctx.config.secret)
    if (!verified) return fail('invalid')
    card = req.card
    // Guest points have no row id; the verdict carries its position instead.
    points = verified.map((p, i) => ({ id: `guest-${i}`, ...p }))
  }
  if (points.length === 0) return fail('invalid')

  const r = await reserveCall(ctx, 'grade')
  if (!r.ok) return fail(r.refusal)
  return spend(r.ticketId, 'grade', 'demoGrade', async () => {
    // ATTRIBUTION: nothing to attribute — a demo grade is never persisted
    // (no QuizAnswer, no analysis row); it lives in the guest's browser.
    const grade = await generateJson({
      userId: ctx.config.aiUserId,
      task: 'grade',
      schema: ShortAnswerGradeWithAnalysisSchema,
      prompt: GRADE_SHORT_ANSWER_PROMPT.build({
        card: card as never,
        answer: req.answer,
        klps: points.map((p, ref) => ({ ref, text: p.text, kind: p.kind })),
      }),
    })
    const verdicts = verdictsFrom(grade, points)
    return { grade, verdicts, accuracy: accuracyOf(verdicts), generatedPoints: req.kind === 'guest' }
  })
}

/** Key points for one guest card (feature `klp-extract`), signed so they can be graded against. */
export async function demoExtractPoints(input: { card: { term: string; definition: string } }): Promise<DemoResult<SignedPoints>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  const parsed = ExtractInput.safeParse(input)
  if (!parsed.success) return fail('invalid')
  const { card } = parsed.data

  const r = await reserveCall(ctx, 'klp-extract')
  if (!r.ok) return fail(r.refusal)
  return spend(r.ticketId, 'klp-extract', 'demoExtractPoints', async () => {
    // ATTRIBUTION: nothing to attribute — demo key points are never persisted;
    // they are signed and handed to the guest's browser.
    const out = await generateJson({
      userId: ctx.config.aiUserId,
      task: 'klp-extract',
      schema: KlpExtractionSchema,
      prompt: EXTRACT_KLPS_PROMPT.build({ setTitle: DEMO_TITLE, cards: [{ ref: 0, ...card }] }),
    })
    const first = out.cards[0]
    if (!first) throw new UnusableReply('extraction returned no card')
    return signPoints(card, first.klps.map((k) => ({ text: k.text, weight: k.weight, kind: k.kind })), ctx.config.secret)
  })
}

/** Opens the guest's one Gauntlet run (multiple choice) over the demo set. No AI. */
export async function demoGauntletRun(): Promise<DemoResult<RunPlan & { cards: { id: string; term: string; definition: string }[] }>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  // Load before opening the run, so a missing set never burns the guest's run.
  const set = await loadDemoSet(ctx.config.setId)
  if (!set || set.cards.length === 0) return fail('demo_off')

  const started = await startRun(ctx, 'gauntlet')
  if (!started.ok) return fail(started.refusal)
  const cards = set.cards.map(({ id, term, definition }) => ({ id, term, definition }))
  const plan = planRun({ cards, memory: [], seed: seedFromString(`${ctx.guestId}:${set.id}:${Date.now()}`), mode: 'mc' })
  return { ok: true, data: { ...plan, cards } }
}

/**
 * Options for one Gauntlet encounter on a demo card. Cached AI options cost
 * nothing; a cache miss spends one `gauntlet` call and is NOT cached (no guest
 * endpoint writes the option cache). A refusal or a failed call still plays,
 * on sibling-card options.
 */
export async function demoGauntletOptions(
  cardId: string,
  ask: 'term' | 'definition',
): Promise<DemoResult<{ options: string[]; correct: string; source: 'ai' | 'fallback' }>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  const id = Id.safeParse(cardId)
  const side = Ask.safeParse(ask)
  if (!id.success || !side.success) return fail('invalid')
  const set = await loadDemoSet(ctx.config.setId)
  const card = set ? findDemoCard(set, id.data) : null
  if (!set || !card) return fail('invalid')

  const rng = mulberry32(seedFromString(`${card.id}:${side.data}:${Date.now()}`))
  const fallback = () => ({
    ok: true as const,
    data: { options: fallbackOptions(card, set.cards, side.data, rng), correct: side.data === 'term' ? card.definition : card.term, source: 'fallback' as const },
  })
  // AI distractors are written for the definition (the card's answer); a
  // term-side question uses sibling terms, as in gauntletOptions.
  if (side.data === 'definition') return fallback()

  const model = await resolveTaskModel(ctx.config.aiUserId, 'distractors')
  if (!model) return fallback()
  const cached = await prisma.quizOptionCache.findUnique({ where: { cardId_model: { cardId: card.id, model } } })
  const hit = cached ? parseOptionCache(cached.options) : null
  if (hit) return { ok: true, data: { options: shuffle(hit.options.map((o) => o.text), rng), correct: hit.correctAnswer, source: 'ai' } }

  const r = await reserveCall(ctx, 'gauntlet')
  if (!r.ok) return fallback()
  const result = await spend(r.ticketId, 'gauntlet', 'demoGauntletOptions', async () => {
    if (card.klps.length > 0) {
      // ATTRIBUTION: nothing to attribute — demo options are never persisted
      // (the cache is deliberately not written from a guest endpoint).
      const g = await generateJson({
        userId: ctx.config.aiUserId,
        task: 'distractors',
        schema: MultipleChoiceKlpSchema,
        prompt: MULTIPLE_CHOICE_PROMPT.build({ card: card as never, siblingCards: set.cards as never, klps: card.klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })) }),
      })
      return { correct: g.correctAnswer, texts: [g.correctAnswer, ...g.distractors.map((d) => d.text)] }
    }
    // ATTRIBUTION: nothing to attribute — never persisted, as above.
    const g = await generateJson({
      userId: ctx.config.aiUserId,
      task: 'distractors',
      schema: MultipleChoiceOptionsSchema,
      prompt: MULTIPLE_CHOICE_PROMPT.build({ card: card as never, siblingCards: set.cards as never }),
    })
    return { correct: g.correctAnswer, texts: g.options }
  })
  if (!result.ok) return fallback()
  return { ok: true, data: { options: shuffle(result.data.texts, rng), correct: result.data.correct, source: 'ai' } }
}

/** Opens the guest's one Hot Seat run over demo cards that have key points. No AI. */
export async function demoStartHotSeat(): Promise<DemoResult<{ cards: HotSeatCard[]; persona: Persona; costume: string }>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  const set = await loadDemoSet(ctx.config.setId)
  const pool = (set?.cards ?? []).filter((c) => c.klps.length > 0).map(({ id, term, definition }) => ({ id, term, definition }))
  if (!set || pool.length === 0) return fail('demo_off')

  const started = await startRun(ctx, 'hot-seat')
  if (!started.ok) return fail(started.refusal)
  const cards = pickHotSeatCards(pool, seedFromString(`${ctx.guestId}:${set.id}:${Date.now()}`), HOT_SEAT_MODES.normal.rounds)
  return { ok: true, data: { cards, persona: personaForSubject(set.subject), costume: getSubject(set.subject)?.group.slug ?? 'default' } }
}

/**
 * Grade a Hot Seat answer on a demo card (one `hot-seat` call). `klpIds`
 * restricts grading to those points, which must belong to the card.
 */
export async function demoGradeGameAnswer(
  cardId: string,
  answer: string,
  opts?: { klpIds?: string[] },
): Promise<DemoResult<{ hit: boolean; accuracy: number; verdicts: KlpVerdict[] }>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  const id = Id.safeParse(cardId)
  const text = Answer.safeParse(answer)
  const options = GameAnswerOpts.safeParse(opts)
  if (!id.success || !text.success || !options.success) return fail('invalid')
  const set = await loadDemoSet(ctx.config.setId)
  const card = set ? findDemoCard(set, id.data) : null
  if (!card) return fail('invalid')
  const wanted = options.data?.klpIds
  const klps = wanted ? card.klps.filter((k) => wanted.includes(k.id)) : card.klps
  if (klps.length === 0 || (wanted && klps.length !== new Set(wanted).size)) return fail('invalid')

  const r = await reserveCall(ctx, 'hot-seat')
  if (!r.ok) return fail(r.refusal)
  return spend(r.ticketId, 'hot-seat', 'demoGradeGameAnswer', async () => {
    // ATTRIBUTION: nothing to attribute — a demo game grade is never persisted.
    const grade = await generateJson({
      userId: ctx.config.aiUserId,
      task: 'grade',
      schema: ShortAnswerGradeWithAnalysisSchema,
      prompt: GRADE_SHORT_ANSWER_PROMPT.build({
        card: card as never,
        answer: text.data,
        klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
      }),
    })
    const verdicts = verdictsFrom(grade, klps)
    const roles = new Map(klps.map((k) => [k.id, k.role]))
    return { hit: isHit(verdicts, roles), accuracy: accuracyOf(verdicts), verdicts }
  })
}

/**
 * The interviewer's follow-up on a missed point of a demo card (one `hot-seat`
 * call). The persona argument is validated but the prompt uses the server's
 * persona for the demo set's subject — a guest can't write prompt text that
 * way.
 */
export async function demoProbeHotSeat(cardId: string, missedKlpId: string, answer: string, persona: Persona): Promise<DemoResult<{ question: string }>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  const id = Id.safeParse(cardId)
  const klpId = Id.safeParse(missedKlpId)
  const text = Answer.safeParse(answer)
  if (!id.success || !klpId.success || !text.success || !PersonaInput.safeParse(persona).success) return fail('invalid')
  const set = await loadDemoSet(ctx.config.setId)
  const card = set ? findDemoCard(set, id.data) : null
  const klp = card?.klps.find((k) => k.id === klpId.data)
  if (!set || !card || !klp) return fail('invalid')

  const r = await reserveCall(ctx, 'hot-seat')
  if (!r.ok) return fail(r.refusal)
  return spend(r.ticketId, 'hot-seat', 'demoProbeHotSeat', async () => {
    // ATTRIBUTION: nothing to attribute — the probe lives in component state
    // for one run and is never persisted.
    const out = await generateJson({
      userId: ctx.config.aiUserId,
      task: 'hot-seat',
      schema: HotSeatProbeSchema,
      prompt: HOT_SEAT_PROBE_PROMPT.build({ persona: personaForSubject(set.subject), question: card.term, answer: text.data, missedPoint: klp.text }),
    })
    return { question: out.question }
  })
}

/** One autocomplete suggestion for a guest card (feature `autocomplete`). */
export async function demoAutocomplete(input: {
  currentText: string
  side: 'term' | 'definition'
  referenceText?: string
  cards: { term: string; definition: string }[]
}): Promise<DemoResult<{ suggestions: string[] }>> {
  const ctx = live(await guestContext())
  if (!ctx) return fail('demo_off')
  const parsed = AutocompleteInput.safeParse(input)
  if (!parsed.success) return fail('invalid')
  const { currentText, side, referenceText, cards } = parsed.data

  const r = await reserveCall(ctx, 'autocomplete')
  if (!r.ok) return fail(r.refusal)
  return spend(r.ticketId, 'autocomplete', 'demoAutocomplete', async () => {
    // ATTRIBUTION: nothing to attribute — suggestions are never persisted;
    // they are shown once in the guest's editor.
    const out = await generateJson({
      userId: ctx.config.aiUserId,
      task: 'autocomplete',
      schema: CardAutocompleteSchema,
      prompt: AUTOCOMPLETE_PROMPT.build({ set: { title: DEMO_TITLE, cards }, currentText, side, categories: [], referenceText }),
    })
    return { suggestions: out.suggestions }
  })
}

/**
 * "Request an invite" — puts the guest's email on the waitlist (no AI, no
 * reservation). Public and anonymous, so: the demo switch first, the guest
 * caps (email ≤ 254, note ≤ 200), five new requests per hashed IP per UTC day
 * (`recordInviteRequest`), and the owner is told only about a NEW email, after
 * the response is sent. The two success statuses are the only thing it says
 * about whether an email was already on the list.
 */
export async function requestInvite(input: { email: string; note?: string }): Promise<DemoResult<{ status: 'added' | 'already' }>> {
  const ctx = await guestContext()
  if (!ctx) return fail('demo_off')
  const parsed = InviteInput.safeParse(input)
  if (!parsed.success) return fail('invalid')
  const email = normalizeEmail(parsed.data.email)
  if (!email) return fail('invalid')
  const note = parsed.data.note || null

  let result: Awaited<ReturnType<typeof recordInviteRequest>>
  try {
    result = await recordInviteRequest({ email, note, ipHash: ctx.ipHash })
  } catch (error) {
    // Name and code only: a Prisma error message can quote the query's
    // arguments, and the email has no place in an error log.
    const e = error as { name?: string; code?: string } | null
    console.error('requestInvite error:', { name: e?.name, code: e?.code })
    return fail('ai_failed')
  }
  if (result.status === 'rate_limited') return fail('rate_limited')
  if (result.status === 'added') after(() => notifyOwner({ kind: 'waitlist_request', email, note }))
  return { ok: true, data: { status: result.status } }
}
