// Pure: node:crypto + zod + schemas only.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { KLP_KINDS } from '@/lib/ai/schemas'

export type KlpKind = (typeof KLP_KINDS)[number]
export type GuestPoint = { text: string; weight: number; kind: KlpKind }
export type SignedPoints = { cardHash: string; points: GuestPoint[]; sig: string }

const SignedPointsSchema = z.object({
  cardHash: z.string(),
  points: z.array(
    z.object({
      text: z.string().min(1),
      weight: z.number().int().min(1).max(5),
      kind: z.enum(KLP_KINDS),
    }),
  ),
  sig: z.string(),
})

type Card = { term: string; definition: string }

export function guestCardHash(card: Card): string {
  return createHash('sha256')
    .update(card.term.trim() + '\u0000' + card.definition.trim())
    .digest('hex')
}

// Fixed key order so the MAC does not depend on how the object was built.
function canonical(points: GuestPoint[]): string {
  return JSON.stringify(points.map((p) => ({ text: p.text, weight: p.weight, kind: p.kind })))
}

function mac(cardHash: string, points: GuestPoint[], secret: string): string {
  return createHmac('sha256', secret)
    .update(cardHash + '\n' + canonical(points))
    .digest('base64url')
}

export function signPoints(card: Card, points: GuestPoint[], secret: string): SignedPoints {
  const cardHash = guestCardHash(card)
  return { cardHash, points, sig: mac(cardHash, points, secret) }
}

export function verifyPoints(card: Card, signed: unknown, secret: string): GuestPoint[] | null {
  const parsed = SignedPointsSchema.safeParse(signed)
  if (!parsed.success) return null
  const cardHash = guestCardHash(card)
  if (parsed.data.cardHash !== cardHash) return null
  const a = Buffer.from(parsed.data.sig)
  const b = Buffer.from(mac(cardHash, parsed.data.points, secret))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return parsed.data.points
}
