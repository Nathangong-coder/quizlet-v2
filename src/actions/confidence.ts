'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { recordStudyEvent } from '@/lib/memory/record'

export async function starCard(
  cardId: string,
  setId: string,
  starred: boolean
): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await prisma.cardProgress.upsert({
    where: { userId_cardId: { userId: session.user.id, cardId } },
    update: { starred },
    create: { userId: session.user.id, cardId, starred, confidence: 5 },
  })

  revalidatePath(`/sets/${setId}`)
}

export async function recordReview(
  cardId: string,
  knew: boolean,
  opts?: { sessionId?: string; latencyMs?: number }
): Promise<{ newConfidence: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const result = await recordStudyEvent({
    userId: session.user.id,
    cardId,
    source: 'review',
    outcome: { correct: knew },
    sessionId: opts?.sessionId,
    meta: { latencyMs: opts?.latencyMs },
  })

  return { newConfidence: result.confidence }
}

export async function updateConfidence(
  cardId: string,
  setId: string,
  confidence: number
): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await prisma.cardProgress.upsert({
    where: { userId_cardId: { userId: session.user.id, cardId } },
    update: { confidence },
    create: { userId: session.user.id, cardId, confidence, starred: false },
  })

  revalidatePath(`/sets/${setId}`)
}
