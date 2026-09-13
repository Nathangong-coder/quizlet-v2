/**
 * The WRITE STEP of topic minting (BUILD-QUEUE item 2), PERSISTENCE half.
 * Takes a plan from `mint-plan.ts` and writes it. See that module for what is
 * written and why; this one only orders the writes and runs the cycle check
 * against what the database already holds.
 */
import { prisma } from '@/lib/db'
import { applyPaths } from './structure'
import { DIRECTED_TYPES } from '@/lib/klp/relations'
import { isDirectedType, wouldCycleRelations, type DirectedEdge, type MintWritePlan } from './mint-plan'

export interface PersistResult {
  concepts: number
  placements: { created: number; skipped: number }
  klpTopics: number
  relationsWritten: number
  relationsSkippedForCycles: string[]
}

export async function persistMintWrites(
  setId: string,
  plan: MintWritePlan,
  models: string[],
): Promise<PersistResult> {
  // 1. Concepts: upsert by normalized name. Exact-name reuse is the upsert.
  const kltIds = new Map<string, string>()
  for (const c of plan.concepts) {
    const row = await prisma.klt.upsert({
      where: { normalizedName: c.normalizedName },
      create: { name: c.name, normalizedName: c.normalizedName },
      update: {},
      select: { id: true },
    })
    kltIds.set(c.normalizedName, row.id)
  }

  // 2. Placement in this set's tree.
  const placements = await applyPaths(setId, plan.paths)

  // 3. Links, replacing the card's existing ones, and the card's status.
  const klpIds = [...new Set(plan.klpTopics.map((t) => t.klpId))]
  await prisma.$transaction(async (tx) => {
    if (klpIds.length > 0) await tx.klpTopic.deleteMany({ where: { klpId: { in: klpIds } } })
    const rows: { klpId: string; kltId: string; rank: number }[] = []
    for (const t of plan.klpTopics) {
      const kltId = kltIds.get(t.normalizedName)
      if (kltId) rows.push({ klpId: t.klpId, kltId, rank: t.rank })
    }
    if (rows.length > 0) await tx.klpTopic.createMany({ data: rows, skipDuplicates: true })
    await tx.card.update({ where: { id: plan.cardId }, data: { kltStatus: 'ready', kltError: null } })
  })

  // 4. Relations, with the cycle check against everything already stored.
  const stored = await prisma.kltRelation.findMany({
    where: { type: { in: [...DIRECTED_TYPES] } },
    select: { fromKltId: true, toKltId: true },
  })
  const directed: DirectedEdge[] = stored.map((e) => ({ from: e.fromKltId, to: e.toKltId }))
  let relationsWritten = 0
  const skipped: string[] = []
  for (const r of plan.relations) {
    const fromId = kltIds.get(r.from)
    const toId = kltIds.get(r.to)
    if (!fromId || !toId) continue
    if (isDirectedType(r.type) && wouldCycleRelations(directed, fromId, toId)) {
      skipped.push(`${r.from} --${r.type}--> ${r.to}`)
      continue
    }
    const existing = await prisma.kltRelation.findUnique({
      where: { fromKltId_toKltId_type: { fromKltId: fromId, toKltId: toId, type: r.type } },
      select: { id: true, cardIds: true, klpIds: true, models: true },
    })
    if (existing) {
      await prisma.kltRelation.update({
        where: { id: existing.id },
        data: {
          cardIds: [...new Set([...existing.cardIds, plan.cardId])],
          klpIds: [...new Set([...existing.klpIds, ...r.klpIds])],
          models: [...new Set([...existing.models, ...models])],
        },
      })
    } else {
      await prisma.kltRelation.create({
        data: { fromKltId: fromId, toKltId: toId, type: r.type, provenance: 'minted', cardIds: [plan.cardId], klpIds: r.klpIds, models },
      })
    }
    if (isDirectedType(r.type)) directed.push({ from: fromId, to: toId })
    relationsWritten++
  }

  return { concepts: plan.concepts.length, placements, klpTopics: plan.klpTopics.length, relationsWritten, relationsSkippedForCycles: skipped }
}
