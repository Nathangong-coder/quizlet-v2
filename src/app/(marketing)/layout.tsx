import { auth } from '@/auth'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import { MarketingHeader } from '@/components/marketing/MarketingHeader'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { STUDY_TOOLS, SUBJECT_LINKS } from '@/lib/marketing/nav'

/**
 * The MARKETING route group: the landing (`/welcome`, served at `/` for a
 * visitor by a middleware rewrite), the feature pages and the legal pages.
 * Its own group and its own layout for one reason — bundle size.
 *
 * A layout's client bundle is built from every client component reachable
 * from it, rendered or not, and a server-side `import()` does not change
 * that. While the landing lived under `(app)`, every anonymous hit shipped
 * the rail, the profile menu and the avatar dialog (Base UI + floating-ui,
 * ~185 KB) it would never render. This layout imports none of that: 782 KiB
 * → ~600 KiB first-load on the landing, measured with
 * `scripts/route-bytes.ts`.
 *
 * `auth()` is still called — to show a signed-in learner "Your library"
 * instead of "Log in" on a feature page — but nothing from the shell.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader signupOpen={isSignupOpen()} signedIn={Boolean(session?.user?.id)} tools={STUDY_TOOLS} subjects={SUBJECT_LINKS} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4">{children}</main>
      <SiteFooter />
    </div>
  )
}
