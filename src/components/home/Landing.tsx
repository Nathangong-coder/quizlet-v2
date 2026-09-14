import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import { getFeature } from '@/lib/marketing/features'
import { Mock } from '@/components/marketing/mocks'
import { StatusBadge } from '@/components/marketing/StatusBadge'

/**
 * The signed-out first screen — simple, one job: get a visitor to sign up
 * (or, when sign-up is closed, to sign in), with the rest of the site one
 * hop away through the top bar's Study tools / Subjects menus, the four
 * tool cards, and the footer.
 *
 * Shape borrowed from Quizlet's home: a question as the headline, one line,
 * ONE button, then four big tool cards, then two zig-zag stories. What is
 * not borrowed: nothing here is advertised that is not built (Learn and
 * Study guides carry their Coming badge) and there is no voice.
 *
 * NO DATA FETCHING. This renders for every anonymous hit including
 * crawlers. `isSignupOpen()` is an env lookup; `tests/components/landing.test.tsx`
 * scans this file for a database import so the rule cannot rot.
 *
 * ONE CALL TO ACTION. The hero has one button. "Browse published sets" is a
 * text link — the one thing that works without an account, deliberately
 * not styled as a second button.
 */

// Light slabs with DARK text in both themes. The base stylesheet paints every
// h2 in --foreground (light on dark), so the title and line carry an explicit
// colour rather than inheriting — Lighthouse caught the dark-mode failure.
const TOOL_CARDS = [
  { slug: 'flashcards', slab: 'bg-indigo-200' },
  { slug: 'test', slab: 'bg-teal-200' },
  { slug: 'study-guides', slab: 'bg-lime-300' },
  { slug: 'games', slab: 'bg-violet-300' },
] as const
const SLAB_TEXT = 'text-slate-950'
const SLAB_MUTED = 'text-slate-800'

export function Landing() {
  const signupOpen = isSignupOpen()
  const cta = signupOpen ? { href: '/signup', label: 'Sign up for free' } : { href: '/login', label: 'Sign in' }
  const test = getFeature('test')!
  const groups = getFeature('games')!

  return (
    <div className="py-10 sm:py-16">
      {/* ---------- Hero ---------- */}
      <section className="mx-auto max-w-3xl text-center" aria-labelledby="hero-title">
        <h1 id="hero-title" className="display mx-auto max-w-[18ch] text-[clamp(2.25rem,1.5rem+3vw,3.5rem)]">
          How do you want to study?
        </h1>
        <p className="lede mx-auto mt-5">
          Flashcards that know what they teach, tests that read your answer point by point, and a memory that only moves when you earn it — all in one place.
        </p>
        <div className="mt-8">
          <Link href={cta.href} className={cn(buttonVariants({ size: 'lg' }), 'h-12 rounded-full px-8 text-base')}>
            {cta.label}
          </Link>
        </div>
        <p className="mt-4 text-sm">
          <Link href="/browse" className="text-primary underline-offset-4 hover:underline">
            Browse published sets without an account
          </Link>
        </p>
      </section>

      {/* ---------- Four tool cards ---------- */}
      <section className="mt-14" aria-label="Study tools">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TOOL_CARDS.map(({ slug, slab }) => {
            const f = getFeature(slug)!
            return (
              <li key={slug}>
                <Link
                  href={`/features/${slug}`}
                  className={cn('group flex h-full flex-col overflow-hidden rounded-2xl transition-transform hover:-translate-y-0.5', slab)}
                >
                  <div className="flex items-center justify-between px-5 pt-5">
                    <h2 className={cn('font-heading text-xl font-bold', SLAB_TEXT)}>{f.label}</h2>
                    {f.status === 'coming' && <span className={cn('rounded-full bg-black/15 px-2 py-0.5 text-[11px] font-semibold', SLAB_TEXT)}>Coming</span>}
                  </div>
                  <p className={cn('px-5 pt-1 text-sm', SLAB_MUTED)}>{f.benefits[0].title}</p>
                  <div className="mt-4 flex-1 px-4 pb-0 text-foreground">
                    <div className="h-full origin-top scale-[0.96] rounded-t-xl transition-transform group-hover:scale-100">
                      <Mock id={f.heroMock} />
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ---------- Start strong ---------- */}
      <section className="mt-24 grid items-center gap-10 lg:grid-cols-2 lg:gap-16" aria-labelledby="start-strong">
        <div>
          <div className="label">Start strong</div>
          <h2 id="start-strong" className="mt-2 font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Write the answer. See exactly what you missed.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Every card carries the handful of ideas a good answer has to contain. Your written answer is read against each one and comes back with the sentence that earned or lost it — not a score, a reason.
          </p>
          <Link href={`/features/${test.slug}`} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline">
            See how a test works
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="rounded-2xl bg-accent p-4 sm:p-8">
          <Mock id="short-answer" />
        </div>
      </section>

      {/* ---------- Stay on track ---------- */}
      <section className="mt-24 grid items-center gap-10 lg:grid-cols-2 lg:gap-16" aria-labelledby="stay-on-track">
        <div className="rounded-2xl bg-accent p-4 sm:p-8 lg:order-1">
          <Mock id="games-hub" />
        </div>
        <div className="lg:order-2">
          <div className="label">Stay on track</div>
          <h2 id="stay-on-track" className="mt-2 font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Small sessions. Honest progress.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Games built from your set, study groups that show who has which card down, and a memory that says &ldquo;not enough evidence&rdquo; rather than inventing a number. It fits into a day and tells you the truth about it.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Link href={`/features/${groups.slug}`} className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline">
              Learning games <StatusBadge feature={groups} />
            </Link>
            <Link href="/features/review" className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline">
              Review &amp; memory
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- Closing ---------- */}
      <section className="mt-24 rounded-2xl bg-accent px-6 py-12 text-center sm:px-10" aria-labelledby="closing">
        <h2 id="closing" className="font-heading text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          Built for finance interview prep first. Works for anything on a card.
        </h2>
        <div className="mt-6">
          <Link href={cta.href} className={cn(buttonVariants({ size: 'lg' }), 'h-12 rounded-full px-8 text-base')}>
            {cta.label}
          </Link>
        </div>
      </section>
    </div>
  )
}
