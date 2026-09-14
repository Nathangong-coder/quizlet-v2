import { FEATURES } from '@/lib/marketing/features'
import { SUBJECTS } from '@/lib/subjects/taxonomy'

/**
 * The signed-out navigation and the footer, as data. One place, so the
 * header's "Study tools" menu, the footer's "For learners" column and the
 * sitemap cannot disagree about what the app offers. Pure.
 */
export interface NavLink {
  href: string
  label: string
  hint?: string
}

/** Study tools ▾ — every feature page plus the two live surfaces that are not features. */
export const STUDY_TOOLS: NavLink[] = [
  ...FEATURES.map((f) => ({ href: `/features/${f.slug}`, label: f.label, hint: f.status === 'coming' ? 'coming' : undefined })),
  { href: '/groups', label: 'Study groups' },
]

/** Subjects ▾ — the nine groups, each to a filtered Browse. */
export const SUBJECT_LINKS: NavLink[] = SUBJECTS.map((g) => ({ href: `/browse?subject=${g.slug}`, label: g.label }))

export interface FooterColumn {
  heading: string
  links: NavLink[]
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'About',
    links: [
      { href: '/features', label: 'How it works' },
      { href: '/browse', label: 'Browse sets' },
      { href: '/help', label: 'Help' },
    ],
  },
  {
    heading: 'For learners',
    links: [...FEATURES.map((f) => ({ href: `/features/${f.slug}`, label: f.label })), { href: '/groups', label: 'Study groups' }],
  },
  {
    heading: 'Account',
    links: [
      { href: '/signup', label: 'Sign up' },
      { href: '/login', label: 'Sign in' },
      { href: '/forgot', label: 'Reset password' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/cookies', label: 'Cookies' },
    ],
  },
]

/** Public, crawlable, static pages — the sitemap's fixed half. */
export const PUBLIC_STATIC_PATHS: string[] = [
  '/',
  '/features',
  ...FEATURES.map((f) => `/features/${f.slug}`),
  '/browse',
  '/privacy',
  '/terms',
  '/cookies',
  '/login',
  '/signup',
]
