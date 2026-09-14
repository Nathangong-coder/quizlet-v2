import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/site'
import { PUBLIC_STATIC_PATHS } from '@/lib/marketing/nav'
import { listableSetWhere } from '@/lib/sets/visibility'
import { isSignupOpen } from '@/lib/auth/signup-flag'

/**
 * `/sitemap.xml`: the fixed public pages, every PUBLIC and LISTABLE set,
 * and every profile with a handle. `listableSetWhere` (not just
 * `visibility: 'public'`) keeps moderation-unlisted sets out — the same rule
 * Browse follows, so a set removed from the directory is not handed to
 * crawlers by the back door. Capped so a runaway corpus cannot make the
 * file unserviceable.
 */
export const revalidate = 3600
const CAP = 5000

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin()
  const now = new Date()
  // /signup 404s while sign-up is closed; do not hand crawlers a dead page.
  const fixed: MetadataRoute.Sitemap = PUBLIC_STATIC_PATHS.filter((p) => p !== '/signup' || isSignupOpen()).map((p) => ({
    url: `${origin}${p}`,
    lastModified: now,
    changeFrequency: p === '/' || p === '/browse' ? 'daily' : 'monthly',
    priority: p === '/' ? 1 : p === '/browse' ? 0.8 : 0.5,
  }))

  const { prisma } = await import('@/lib/db')
  const [sets, users] = await Promise.all([
    prisma.set.findMany({ where: listableSetWhere(), select: { id: true, updatedAt: true }, orderBy: { publishedAt: 'desc' }, take: CAP }),
    prisma.user.findMany({ where: { handle: { not: null } }, select: { handle: true, updatedAt: true }, take: CAP }),
  ])

  return [
    ...fixed,
    ...sets.map((s) => ({ url: `${origin}/sets/${s.id}`, lastModified: s.updatedAt, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...users.map((u) => ({ url: `${origin}/u/${u.handle}`, lastModified: u.updatedAt, changeFrequency: 'weekly' as const, priority: 0.3 })),
  ]
}
