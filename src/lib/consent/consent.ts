/**
 * Cookie / analytics consent. Pure vocabulary + (de)serialisation; the
 * browser-facing store is `use-consent.ts`.
 *
 * What the app actually sets: an ESSENTIAL session cookie for sign-in
 * (Auth.js) and nothing else. Analytics (Vercel Analytics) is cookieless,
 * but it is still tracking, so it runs only after the visitor says yes —
 * "essential only" is a real choice, not a decoy.
 */
export const CONSENT_STORAGE_KEY = 'synapsehq:consent'
export const CONSENT_VERSION = 1

export type ConsentChoice = 'all' | 'essential'

export interface ConsentRecord {
  version: number
  choice: ConsentChoice
  decidedAt: string
}

export function parseConsent(raw: string | null): ConsentRecord | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<ConsentRecord>
    if (v.version !== CONSENT_VERSION) return null
    if (v.choice !== 'all' && v.choice !== 'essential') return null
    if (typeof v.decidedAt !== 'string') return null
    return { version: CONSENT_VERSION, choice: v.choice, decidedAt: v.decidedAt }
  } catch {
    return null
  }
}

export function serializeConsent(choice: ConsentChoice, now: Date = new Date()): string {
  const rec: ConsentRecord = { version: CONSENT_VERSION, choice, decidedAt: now.toISOString() }
  return JSON.stringify(rec)
}

export function analyticsAllowed(rec: ConsentRecord | null): boolean {
  return rec?.choice === 'all'
}
