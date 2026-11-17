// Pure: node:crypto only.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const DEMO_COOKIE = 'synapse_demo'

const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

function mac(id: string, secret: string): string {
  return createHmac('sha256', secret).update('demo-guest:' + id).digest('base64url')
}

export function signGuestId(id: string, secret: string): string {
  return `${id}.${mac(id, secret)}`
}

export function verifyGuestCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot < 0) return null
  const id = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  if (!ID_PATTERN.test(id)) return null
  const a = Buffer.from(sig)
  const b = Buffer.from(mac(id, secret))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return id
}

export function newGuestId(): string {
  return randomBytes(18).toString('base64url')
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (fwd) return fwd
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

export function hashIp(ip: string, secret: string): string {
  return createHash('sha256').update('demo-ip:' + secret + ':' + ip).digest('hex')
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}
