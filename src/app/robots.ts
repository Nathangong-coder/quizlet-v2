import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/site'

/**
 * `/robots.txt`. Public content is crawlable; everything that is per-account
 * or a write surface is not — not because it leaks (every one of those
 * routes checks the session), but because there is nothing there for a
 * crawler and a 302 to /login indexed a thousand times is noise.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/account',
          '/settings',
          '/profile',
          '/groups',
          '/folders',
          '/notes',
          '/postmortem',
          '/diagnostic',
          '/staff',
          '/sets/new',
          '/sets/*/edit',
          '/sets/*/quiz',
          '/sets/*/review',
          '/sets/*/print',
          '/sets/*/games',
          '/reset/',
          '/verify/',
        ],
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  }
}
