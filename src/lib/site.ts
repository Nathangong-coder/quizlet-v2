import { appOrigin } from '@/lib/mail/origin'

/**
 * The site's public identity for metadata: name, tagline, and the absolute
 * origin every `og:image`, sitemap entry and canonical URL is built on.
 * `appOrigin` already resolves NEXTAUTH_URL → VERCEL_URL → localhost; on
 * Vercel production `VERCEL_PROJECT_PRODUCTION_URL` is the stable domain
 * (VERCEL_URL is the per-deployment one), so it is preferred when present.
 */
export const SITE_NAME = 'synapseHQ'
export const SITE_TAGLINE = 'Write the answer. See exactly what you missed.'
export const SITE_DESCRIPTION =
  'Flashcards that know what they teach, tests that read your written answer point by point, study groups, games, and a memory that only moves when you earn it. Built for finance interview prep; works for anything on a card.'

export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const prod = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (prod) return `https://${prod}`
  return appOrigin({ NEXTAUTH_URL: env.NEXTAUTH_URL, VERCEL_URL: env.VERCEL_URL })
}

/** "Page · synapseHQ" — the template every page title follows. */
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`
