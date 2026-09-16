/**
 * BUILD A SET'S KEY POINTS AND TOPICS, IN STEPS (2026-09-16).
 *
 * Until now the discrimination-tested authoring and the topic minting ran
 * only from operator scripts; an owner who edited a set got the legacy
 * one-pass extraction and a daily cron that authors six cards. This module
 * is the owner's path: one bounded STEP at a time, so it fits inside a
 * server action's wall clock, and a client loop calls it until nothing is
 * left. Each step does the first thing the set needs:
 *
 *   1. AUTHOR — a card whose live points are not from the current authoring
 *      pipeline (`klpStatus` pending, or no `CardAuthoring` at its
 *      `klpVersion`) goes through `authorCard` on the owner's credentials
 *      (`generators.ts`) and is persisted; its topic fragment is now stale.
 *   2. MINT — a card whose `topicKlpVersion` is not its `klpVersion` goes
 *      through the minting loop; the fragment is stored on the card.
 *   3. REBUILD — when every card is authored and minted, the set's tree is
 *      re-planned from the stored fragments (`rebuildTree`) and written
 *      (`persistTreePlan`) WITHOUT resetting placement: a node the owner has
 *      already placed keeps its place; new nodes land where the votes put
 *      them. The one-call chapter skeleton runs only when the set has no
 *      placement yet — it is the owner's tree to reshape after that.
 *
 * Cards are marked `klpStatus: 'pending'` by `updateSet` the moment an edit
 * commits, so the status this module reports is honest before any AI call.
 * `budgetMs` bounds a step; a card that does not finish inside it is simply
 * left for the next step. Failures are recorded on the card
 * (`kltError` / `klpError`) and reported, never thrown past the step.
 */
import { prisma } from '@/lib/db'
import { authorCard } from '@/lib/klp/authoring'
import { persistAuthoring } from '@/lib/klp/authoring-persist'
import { AUTHOR_KLPS_PROMPT } from '@/lib/ai/prompts/author-klps'
import { findExistingPanel } from '@/lib/klp/panel-reuse'
import { classifyProviderError } from '@/lib/errors/classify'
import { mintCardLoop } from '@/lib/klp/topic-loop'
import { cardMode } from '@/lib/klp/card-mode'
import type { KlpLink } from '@/lib/klp/topic-enforcement'
import { rebuildTree, type CardFragment } from '@/lib/klt/rebuild'
import { persistTreePlan } from '@/lib/klt/rebuild-write'
import type { VocabEntry } from '@/lib/klt/match'
import { authoringGenerator, topicGenerator } from '@/lib/klp/generators'
import type { AuthoringGenerator } from '@/lib/klp/authoring'
import type { TopicGenerator } from '@/lib/klp/topic-loop'
import type { CardTopicProposalV2 } from '@/lib/klp/topic-minting-v2'
import { Prisma } from '@prisma/client'

export interface SetBuildStatus {
  cards: number
  /** Cards whose points are not from the current pipeline at their current version. */
  needAuthoring: number
  /** Cards authored but whose topic fragment is missing or from older points. */
  needMinting: number
  /** Cards authored and minted whose set tree has not been rebuilt since. */
  needRebuild: number
  /** Cards with an error recorded on the last attempt. */
  failed: number
  /** Nothing to do. */
  ready: boolean
}

export interface SetBuildStep {
  did: 'author' | 'mint' | 'rebuild' | 'nothing'
  /** Cards processed by this step. */
  cards: string[]
  errors: { cardId: string; kind: string }[]
  status: SetBuildStatus
}

export const AUTHOR_PER_STEP = 2
export const MINT_PER_STEP = 3
export const STEP_BUDGET_MS = 120_000

type CardRow = { id: string; term: string; definition: string; klpStatus: string; kltStatus: string; klpVersion: number; topicKlpVersion: number | null; kltError: string | null; klpError: string | null; authoredVersion: number | null; klpCount: number }

async function loadCards(setId: string): Promise<CardRow[]> {
  const rows = await prisma.card.findMany({
    where: { setId },
    orderBy: { position: 'asc' },
    select: {
      id: true, term: true, definition: true, klpStatus: true, kltStatus: true, klpVersion: true, topicKlpVersion: true, kltError: true, klpError: true,
      authorings: { orderBy: { createdAt: 'desc' }, take: 1, select: { klpVersion: true } },
      _count: { select: { klps: { where: { supersededAt: null } } } },
    },
  })
  return rows.map((r) => ({ id: r.id, term: r.term, definition: r.definition, klpStatus: r.klpStatus, kltStatus: r.kltStatus, klpVersion: r.klpVersion, topicKlpVersion: r.topicKlpVersion, kltError: r.kltError, klpError: r.klpError, authoredVersion: r.authorings[0]?.klpVersion ?? null, klpCount: r._count.klps }))
}

const needsAuthoring = (c: CardRow) => c.klpStatus === 'pending' || c.authoredVersion === null || c.authoredVersion !== c.klpVersion || c.klpCount === 0
const needsMinting = (c: CardRow) => !needsAuthoring(c) && c.topicKlpVersion !== c.klpVersion
const needsRebuild = (c: CardRow) => !needsAuthoring(c) && !needsMinting(c) && c.kltStatus !== 'ready'

export function summarize(cards: CardRow[]): SetBuildStatus {
  const needAuthoring = cards.filter(needsAuthoring).length
  const needMinting = cards.filter(needsMinting).length
  const needRebuild = cards.filter(needsRebuild).length
  const failed = cards.filter((c) => (c.klpError && needsAuthoring(c)) || (c.kltError && (needsMinting(c) || needsRebuild(c)))).length
  return { cards: cards.length, needAuthoring, needMinting, needRebuild, failed, ready: needAuthoring + needMinting + needRebuild === 0 }
}

export async function setBuildStatus(setId: string): Promise<SetBuildStatus> {
  return summarize(await loadCards(setId))
}

export interface BuildGenerators {
  authoring: AuthoringGenerator
  topic: TopicGenerator
}

/**
 * One bounded step. `userId` pays for the calls (the owner). `generators`
 * is injectable so a script or a test can run the same step over env keys
 * or fakes; the app always passes the owner's credential-pool generators.
 */
export async function buildSetStep(userId: string, setId: string, opts: { budgetMs?: number; now?: () => number; generators?: BuildGenerators } = {}): Promise<SetBuildStep> {
  const now = opts.now ?? (() => Date.now())
  const startedAt = now()
  const budget = opts.budgetMs ?? STEP_BUDGET_MS
  const outOfTime = () => now() - startedAt > budget
  const set = await prisma.set.findUnique({ where: { id: setId }, select: { title: true } })
  if (!set) return { did: 'nothing', cards: [], errors: [], status: { cards: 0, needAuthoring: 0, needMinting: 0, needRebuild: 0, failed: 0, ready: true } }
  let cards = await loadCards(setId)
  const errors: { cardId: string; kind: string }[] = []

  // 1. author
  const toAuthor = cards.filter(needsAuthoring).slice(0, AUTHOR_PER_STEP)
  if (toAuthor.length) {
    const done: string[] = []
    for (const card of toAuthor) {
      if (done.length && outOfTime()) break
      let model: string | undefined
      try {
        const blocks = await prisma.cardContentBlock.findMany({ where: { cardId: card.id }, select: { side: true, type: true, text: true, assetId: true, position: true } })
        const outcome = await authorCard(
          { setTitle: set.title, question: card.term, definition: card.definition, existingPanel: (await findExistingPanel(card.id))?.members },
          opts.generators?.authoring ?? authoringGenerator(userId, (m) => { model = m }),
        )
        await persistAuthoring(card.id, outcome, AUTHOR_KLPS_PROMPT.version, { term: card.term, definition: card.definition, blocks }, model)
        // the points changed: the fragment and the tree are stale
        await prisma.card.update({ where: { id: card.id }, data: { kltStatus: 'pending', kltError: null } })
        done.push(card.id)
      } catch (error) {
        const kind = classifyProviderError(error)
        errors.push({ cardId: card.id, kind })
        await prisma.card.update({ where: { id: card.id }, data: { klpError: `${kind}: ${(error as Error).message}`.slice(0, 500) } }).catch(() => undefined)
        if (kind === 'quota_exhausted' || kind === 'no_credentials' || kind === 'credentials_unavailable') break
      }
    }
    return { did: 'author', cards: done, errors, status: summarize(await loadCards(setId)) }
  }

  // 2. mint
  const toMint = cards.filter(needsMinting).slice(0, MINT_PER_STEP)
  if (toMint.length) {
    const done: string[] = []
    const gen = opts.generators?.topic ?? topicGenerator(userId)
    for (const card of toMint) {
      if (done.length && outOfTime()) break
      try {
        const klps = await prisma.cardKlp.findMany({ where: { cardId: card.id, supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, index: true, text: true, kind: true, relationsFrom: { select: { toKlpId: true, type: true } } } })
        const byId = new Map(klps.map((k) => [k.id, k.index]))
        const links: KlpLink[] = klps.flatMap((k) => k.relationsFrom.flatMap((r) => (byId.has(r.toKlpId) ? [{ from: k.index, to: byId.get(r.toKlpId)!, type: r.type }] : [])))
        const authoring = await prisma.cardAuthoring.findFirst({ where: { cardId: card.id }, orderBy: { createdAt: 'desc' }, select: { questionType: true } })
        const mode = cardMode({ questionType: authoring?.questionType ?? null, kinds: klps.map((k) => k.kind) })
        const outcome = await mintCardLoop({ term: card.term, setTitle: set.title, klps: klps.map((k) => ({ text: k.text, kind: k.kind })), links, mode }, gen)
        await prisma.card.update({ where: { id: card.id }, data: { topicProposal: outcome.proposal as unknown as Prisma.InputJsonValue, topicKlpVersion: card.klpVersion, kltStatus: 'pending', kltError: null } })
        done.push(card.id)
      } catch (error) {
        const kind = classifyProviderError(error)
        errors.push({ cardId: card.id, kind })
        await prisma.card.update({ where: { id: card.id }, data: { kltError: `${kind}: ${(error as Error).message}`.slice(0, 500) } }).catch(() => undefined)
        if (kind === 'quota_exhausted' || kind === 'no_credentials' || kind === 'credentials_unavailable') break
      }
    }
    return { did: 'mint', cards: done, errors, status: summarize(await loadCards(setId)) }
  }

  // 3. rebuild
  cards = await loadCards(setId)
  if (cards.some(needsRebuild)) {
    const r = await rebuildSetTree(setId)
    return { did: 'rebuild', cards: r.cards, errors, status: summarize(await loadCards(setId)) }
  }
  return { did: 'nothing', cards: [], errors, status: summarize(cards) }
}

/**
 * Re-plan and write a set's tree from the fragments stored on its cards.
 * Never resets placement: the owner's hand edits win. Pure TypeScript
 * (no judge, no chapter call) unless `chapters` is asked for by a caller
 * that also supplies the model calls — this path is meant to be cheap and
 * automatic; the operator script has the model-assisted passes.
 */
export async function rebuildSetTree(setId: string): Promise<{ cards: string[]; nodes: number }> {
  const rows = await prisma.card.findMany({ where: { setId, topicProposal: { not: Prisma.JsonNull } }, select: { id: true, term: true, klpVersion: true, topicKlpVersion: true, topicProposal: true, authorings: { orderBy: { createdAt: 'desc' }, take: 1, select: { questionType: true } }, klps: { where: { supersededAt: null }, select: { kind: true } } } })
  const fragments: CardFragment[] = []
  for (const r of rows) {
    if (r.topicKlpVersion !== r.klpVersion) continue
    const p = r.topicProposal as unknown as CardTopicProposalV2
    if (!p || !p.anchor) continue
    fragments.push({ cardId: r.id, term: r.term, anchor: p.anchor, domain: p.domain, leaves: p.leaves, contexts: p.contexts, relations: p.relations, mode: cardMode({ questionType: r.authorings[0]?.questionType ?? null, kinds: r.klps.map((k) => k.kind) }) })
  }
  if (!fragments.length) return { cards: [], nodes: 0 }
  const klts = await prisma.klt.findMany({ where: { status: { not: 'merged' } }, select: { id: true, name: true, normalizedName: true, status: true, aliases: { select: { normalizedName: true } } } })
  const vocab: VocabEntry[] = klts.map((k) => ({ kltId: k.id, name: k.name, normalizedName: k.normalizedName, status: k.status, aliases: k.aliases.map((a) => a.normalizedName) }))
  const plan = rebuildTree(setId, fragments, vocab)
  await persistTreePlan(plan, fragments, 'in-app', { resetPlacement: false })
  return { cards: fragments.map((f) => f.cardId), nodes: plan.nodes.filter((n) => n.role !== 'label' && n.role !== 'alias').length }
}
