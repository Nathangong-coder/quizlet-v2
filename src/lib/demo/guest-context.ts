// The calling guest's identity, for server actions only (it may set a cookie).
// Kept apart from ./guard so the guard never imports next/headers.
import { cookies, headers } from 'next/headers'
import { readDemoConfig } from './config'
import type { GuestCtx } from './guard'
import { DEMO_COOKIE, clientIp, hashIp, newGuestId, signGuestId, verifyGuestCookie } from './identity'

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60

/**
 * The guest from the signed cookie (issued afresh if missing or forged) and
 * the hashed client IP. `null` when the demo is off.
 */
export async function guestContext(): Promise<GuestCtx | null> {
  const config = readDemoConfig()
  if (!config.enabled || !config.secret) return null
  const jar = await cookies()
  const hdrs = await headers()
  let guestId = verifyGuestCookie(jar.get(DEMO_COOKIE)?.value, config.secret)
  if (!guestId) {
    guestId = newGuestId()
    jar.set(DEMO_COOKIE, signGuestId(guestId, config.secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE_S,
      path: '/',
    })
  }
  return { guestId, ipHash: hashIp(clientIp(hdrs), config.secret), config }
}
