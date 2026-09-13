'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { generateJson, generateJsonWithMeta, AiGenerationError } from '@/lib/ai/generate'
import { GRADE_SHORT_ANSWER_PROMPT, MAKE_GAME_PIECES_PROMPT, HOT_SEAT_PROBE_PROMPT } from '@/lib/ai/prompts/registry'
import { ShortAnswerGradeSchema, GamePiecesSchema, HotSeatProbeSchema } from '@/lib/ai/schemas'
import { isShortCard, termPiece, acceptCloze } from '@/lib/games/pieces'
import { planRun, type RunPlan } from '@/lib/games/gauntlet'
import { pickHotSeatCards, type KlpVerdict, type HotSeatCard } from '@/lib/games/hot-seat'
import { personaForSubject, type Persona } from '@/lib/games/personas'
import { seedFromString } from '@/lib/games/rng'
import type { PrepareSummary } from '@/lib/games/load'
import type { ActionResult } from '@/types/action'

/**
 * Learning games — the server side. Four jobs and nothing else: prepare
 * pieces (owner), plan a Gauntlet run (the ONLY memory read), grade a typed
 * answer, write a Hot Seat probe.
 *
 * GAMES WRITE NO HISTORY. `gradeGameAnswer` and `probeHotSeat` create no
 * QuizAnswer, StudyEvent, ConfidenceEvent or KlpState row —
 * tests/games/actions.test.ts asserts this against the Prisma mock. The only
 * writes in this file are the owner's piece preparation and the enable toggle.
 *
 * Design: docs/superpowers/specs/2026-09-13-learning-games-design.md.
 */

const PIECE_BATCH = 10

async function ownedSet(setId: string, userId: string) {
  return prisma.set.findFirst({ where: { id: setId, userId }, select: { id: true } })
}

// ------------------------------------------------------------- preparation

export async function prepareGamePieces(setId: string): Promise<ActionResult<PrepareSummary>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const userId = session.user.id
  if (!(await ownedSet(setId, userId))) return { success: false, error: 'Set not found' }

  const cards = await prisma.card.findMany({
    where: { setId },
    orderBy: { position: 'asc' },
    select: { id: true, term: true, definition: true, klpStatus: true, klpVersion: true, klpSourceHash: true },
  })
  const live = await prisma.gamePiece.findMany({ where: { setId }, select: { cardId: true, klpVersion: true } })
  const hasLive = new Set(live.filter((p) => cards.some((c) => c.id === p.cardId && c.klpVersion === p.klpVersion)).map((p) => p.cardId))

  const summary: PrepareSummary = { made: 0, copied: 0, generated: 0, skipped: [], failed: [] }
  const toGenerate: typeof cards = []

  for (const card of cards) {
    if (hasLive.has(card.id)) continue
    const hash = card.klpSourceHash

    // 1. Donor: any card anywhere with the same source hash and live pieces.
    //    Exact match only (see src/lib/klp/reuse.ts for why).
    if (hash) {
      const donorRows = await prisma.gamePiece.findMany({
        where: { sourceHash: hash, cardId: { not: card.id }, card: { klpSourceHash: hash } },
        select: { cardId: true, klpVersion: true, klpId: true, kind: true, prompt: true, answer: true, aliases: true, model: true, enabled: true, card: { select: { klpVersion: true } } },
      })
      const liveDonor = donorRows.filter((r) => r.klpVersion === r.card.klpVersion)
      if (liveDonor.length > 0) {
        // Prefer the donor card with the most pieces.
        const counts = new Map<string, number>()
        for (const r of liveDonor) counts.set(r.cardId, (counts.get(r.cardId) ?? 0) + 1)
        const bestDonor = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        const donorKlpIds = liveDonor.map((r) => r.klpId).filter((id): id is string => id !== null)
        const [myKlps, donorKlps] = await Promise.all([
          prisma.cardKlp.findMany({ where: { cardId: card.id, supersededAt: null }, select: { id: true, index: true } }),
          donorKlpIds.length ? prisma.cardKlp.findMany({ where: { id: { in: donorKlpIds } }, select: { id: true, index: true } }) : Promise.resolve([]),
        ])
        const myKlpByIndex = new Map(myKlps.map((k) => [k.index, k.id]))
        const donorIndex = new Map(donorKlps.map((k) => [k.id, k.index]))
        const rows = liveDonor
          .filter((r) => r.cardId === bestDonor)
          .map((r) => ({
            cardId: card.id,
            setId,
            // Remapped by KLP index; a piece whose index has no counterpart is dropped.
            klpId: r.klpId === null ? null : (myKlpByIndex.get(donorIndex.get(r.klpId) ?? -1) ?? null),
            klpVersion: card.klpVersion,
            sourceHash: hash,
            kind: r.kind,
            prompt: r.prompt,
            answer: r.answer,
            aliases: r.aliases ?? [],
            enabled: r.enabled,
            model: r.model,
          }))
          .filter((r) => r.kind === 'term' || r.klpId !== null)
        if (rows.length > 0) {
          await prisma.gamePiece.createMany({ data: rows.map((r) => ({ ...r, aliases: r.aliases as object })) })
          summary.copied += rows.length
          continue
        }
      }
    }

    // 2. Short card: the term piece, no call.
    if (isShortCard(card)) {
      const t = termPiece(card)
      await prisma.gamePiece.create({
        data: { cardId: card.id, setId, klpId: null, klpVersion: card.klpVersion, sourceHash: hash ?? `card:${card.id}`, ...t, model: null },
      })
      summary.made += 1
      continue
    }

    // 3. Needs key points.
    if (card.klpStatus !== 'ready') {
      summary.skipped.push({ cardId: card.id, reason: 'no_klps' })
      continue
    }
    toGenerate.push(card)
  }

  // 4. Generate, batched. A failed batch marks its cards failed and the run continues.
  for (let i = 0; i < toGenerate.length; i += PIECE_BATCH) {
    const batch = toGenerate.slice(i, i + PIECE_BATCH)
    const klpsByCard = new Map<string, { id: string; index: number; text: string }[]>()
    for (const c of batch) {
      klpsByCard.set(c.id, await prisma.cardKlp.findMany({ where: { cardId: c.id, supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, index: true, text: true } }))
    }
    try {
      const { value, meta } = await generateJsonWithMeta({
        userId,
        task: 'distractors',
        schema: GamePiecesSchema,
        maxOutputTokens: 4096,
        prompt: MAKE_GAME_PIECES_PROMPT.build({
          cards: batch.map((c, ref) => ({ ref, term: c.term, definition: c.definition, klps: (klpsByCard.get(c.id) ?? []).map((k, kref) => ({ ref: kref, text: k.text })) })),
        }),
      })
      const produced = new Set<string>()
      const seenKlp = new Set<string>()
      for (const p of value.pieces) {
        const card = batch[p.cardRef]
        const klp = card ? klpsByCard.get(card.id)?.[p.klpRef] : undefined
        if (!card || !klp || seenKlp.has(klp.id)) continue
        const accepted = acceptCloze(p)
        if (!accepted) continue
        seenKlp.add(klp.id)
        await prisma.gamePiece.create({
          data: { cardId: card.id, setId, klpId: klp.id, klpVersion: card.klpVersion, sourceHash: card.klpSourceHash ?? `card:${card.id}`, ...accepted, model: meta.model },
        })
        produced.add(card.id)
        summary.generated += 1
      }
      for (const c of batch) if (!produced.has(c.id)) summary.skipped.push({ cardId: c.id, reason: 'no_short_answer' })
    } catch (error) {
      const kind = error instanceof AiGenerationError ? error.detail.title : 'internal'
      for (const c of batch) summary.failed.push({ cardId: c.id, kind })
    }
  }

  await prisma.set.update({ where: { id: setId }, data: { gamesPreparedAt: new Date(), gamesPrepareSummary: summary as object } })
  revalidatePath(`/sets/${setId}/games`)
  return { success: true, data: summary }
}

export async function setGamePieceEnabled(pieceId: string, enabled: boolean): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const piece = await prisma.gamePiece.findFirst({ where: { id: pieceId, set: { userId: session.user.id } }, select: { id: true, setId: true } })
  if (!piece) return { success: false, error: 'Piece not found' }
  await prisma.gamePiece.update({ where: { id: piece.id }, data: { enabled } })
  revalidatePath(`/sets/${piece.setId}/games/pieces`)
  return { success: true, data: undefined }
}

// -------------------------------------------------------------- Gauntlet

/**
 * THE ONE MEMORY READ in the games. Confidence and due-ness per card, for
 * the viewer, on a readable set. Correct answers for typed rooms are not in
 * the payload — the client never holds them.
 */
export async function buildGauntletRun(setId: string, opts: { mcOnly: boolean }): Promise<ActionResult<RunPlan & { cards: { id: string; term: string; definition: string }[] }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Sign in to play Gauntlet' }
  const set = await prisma.set.findFirst({
    where: { id: setId, ...readableSetWhere(session.user.id) },
    select: { id: true, cards: { orderBy: { position: 'asc' }, select: { id: true, term: true, definition: true } } },
  })
  if (!set) return { success: false, error: 'Set not found' }
  const now = new Date()
  const progress = await prisma.cardProgress.findMany({
    where: { userId: session.user.id, cardId: { in: set.cards.map((c) => c.id) } },
    select: { cardId: true, confidence: true, dueAt: true },
  })
  const memory = progress.map((p) => ({ cardId: p.cardId, confidence: p.confidence, due: p.dueAt === null || p.dueAt <= now }))
  const plan = planRun({ cards: set.cards, memory, seed: seedFromString(`${session.user.id}:${setId}:${Date.now()}`), mcOnly: opts.mcOnly })
  return { success: true, data: { ...plan, cards: set.cards } }
}

// -------------------------------------------------------------- grading

/** Hit = every substance key point with weight ≥ 4 is passed. Computed in TS. */
function isHit(verdicts: KlpVerdict[], roles: Map<string, string | null>): boolean {
  const heavy = verdicts.filter((v) => v.weight >= 4 && (roles.get(v.klpId) ?? 'substance') !== 'framing')
  if (heavy.length === 0) return verdicts.every((v) => v.status !== 'failed')
  return heavy.every((v) => v.status === 'passed')
}

/**
 * Grade a typed answer against a card's live key points. NO WRITES. Returns
 * the per-point verdicts and a TypeScript-computed hit. `klpIds` restricts
 * the grading to those points (a Hot Seat probe reply is judged on one).
 */
export async function gradeGameAnswer(
  cardId: string,
  answer: string,
  opts: { klpIds?: string[] } = {},
): Promise<ActionResult<{ hit: boolean; verdicts: KlpVerdict[] }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const card = await prisma.card.findFirst({
    where: { id: cardId, set: readableSetWhere(session.user.id) },
    select: { id: true, term: true, definition: true, setId: true, position: true, createdAt: true, updatedAt: true },
  })
  if (!card) return { success: false, error: 'Card not found' }
  const trimmed = answer.trim()
  if (trimmed.length === 0) return { success: false, error: 'Write an answer first' }

  const klpsAll = await prisma.cardKlp.findMany({
    where: { cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, text: true, weight: true, kind: true, role: true },
  })
  const klps = opts.klpIds ? klpsAll.filter((k) => opts.klpIds!.includes(k.id)) : klpsAll
  if (klps.length === 0) return { success: false, error: 'This card has no key points to grade against' }

  try {
    // ATTRIBUTION: nothing to attribute. A game grade is never persisted —
    // no QuizAnswer, no analysis row — so there is no artifact to stamp.
    const grade = await generateJson({
      userId: session.user.id,
      task: 'grade',
      schema: ShortAnswerGradeSchema,
      prompt: GRADE_SHORT_ANSWER_PROMPT.build({
        card: card as never,
        answer: trimmed,
        klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
      }),
    })
    const byRef = new Map((grade.klpResults ?? []).map((r) => [r.klpRef, r.status]))
    const verdicts: KlpVerdict[] = klps.map((k, ref) => ({ klpId: k.id, text: k.text, weight: k.weight, status: byRef.get(ref) ?? 'failed' }))
    const roles = new Map(klps.map((k) => [k.id, k.role]))
    return { success: true, data: { hit: isHit(verdicts, roles), verdicts } }
  } catch (error) {
    if (error instanceof AiGenerationError) return { success: false, error: error.detail.fix ? `${error.detail.title} — ${error.detail.fix.label}` : error.detail.title }
    console.error('gradeGameAnswer error:', error)
    return { success: false, error: 'Grading failed' }
  }
}

// -------------------------------------------------------------- Hot Seat

export async function startHotSeat(setId: string): Promise<ActionResult<{ cards: HotSeatCard[]; persona: Persona }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Sign in to play Hot Seat' }
  const set = await prisma.set.findFirst({
    where: { id: setId, ...readableSetWhere(session.user.id) },
    select: { subject: true, cards: { where: { klpStatus: 'ready' }, select: { id: true, term: true, definition: true } } },
  })
  if (!set) return { success: false, error: 'Set not found' }
  const cards = pickHotSeatCards(set.cards, seedFromString(`${session.user.id}:${setId}:${Date.now()}`))
  return { success: true, data: { cards, persona: personaForSubject(set.subject) } }
}

export async function probeHotSeat(cardId: string, missedKlpId: string, answer: string, persona: Persona): Promise<ActionResult<{ question: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const card = await prisma.card.findFirst({ where: { id: cardId, set: readableSetWhere(session.user.id) }, select: { term: true } })
  if (!card) return { success: false, error: 'Card not found' }
  const klp = await prisma.cardKlp.findFirst({ where: { id: missedKlpId, cardId }, select: { text: true } })
  if (!klp) return { success: false, error: 'Key point not found' }
  try {
    // ATTRIBUTION: nothing to attribute — the probe lives in component state
    // for one run and is never persisted.
    const out = await generateJson({
      userId: session.user.id,
      task: 'grade',
      schema: HotSeatProbeSchema,
      prompt: HOT_SEAT_PROBE_PROMPT.build({ persona, question: card.term, answer, missedPoint: klp.text }),
    })
    return { success: true, data: { question: out.question } }
  } catch (error) {
    if (error instanceof AiGenerationError) return { success: false, error: error.message }
    console.error('probeHotSeat error:', error)
    return { success: false, error: 'Could not write a follow-up' }
  }
}
