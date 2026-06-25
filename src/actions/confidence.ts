'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'

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
  knew: boolean
): Promise<{ newConfidence: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const userId = session.user.id

  const current = await prisma.cardProgress.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { confidence: true },
  })

  const oldConfidence = current?.confidence ?? 5
  const newConfidence = knew
    ? Math.min(10, oldConfidence + 1)
    : Math.max(1, oldConfidence - 1)

  await prisma.$transaction([
    prisma.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: { confidence: newConfidence },
      create: { userId, cardId, confidence: newConfidence, starred: false },
    }),
    prisma.confidenceEvent.create({
      data: { userId, cardId, confidence: newConfidence, knew },
    }),
  ])

  return { newConfidence }
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
