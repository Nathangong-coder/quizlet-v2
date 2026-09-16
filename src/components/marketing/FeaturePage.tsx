import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import { FEATURES, type Feature } from '@/lib/marketing/features'
import { Mock } from '@/components/marketing/mocks'
import { StatusBadge } from '@/components/marketing/StatusBadge'

/**
 * One feature, the way Quizlet lays its feature pages out: a hero with the
 * claim, three benefits and a large mock on a coloured slab; zig-zag sections
 * alternating the mock's side; the other features; a closing call.
 *
 * NO DATA FETCHING — see `Landing`. Rendered for every anonymous hit, so it
 * must not be a database read. `isSignupOpen()` is an env lookup.
 *
 * The sign-up link is gated the same way the landing gates it: `/signup`
 * calls `notFound()` when the flag is off. Sign-in is never gated.
 */
export function FeaturePage({ feature }: { feature: Feature }) {
  const signupOpen = isSignupOpen()
  const Icon = feature.icon
  const others = FEATURES.filter((f) => f.slug !== feature.slug)

  return (
    <article className="py-8 sm:py-12">
      {/* ---------- Hero ---------- */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Icon className="h-4 w-4" aria-hidden={true} />
            {feature.label}
            <StatusBadge feature={feature} />
          </div>
          <h1 className="display mt-3">{feature.claim}</h1>
          <p className="lede mt-5">{feature.body}</p>

          <ul className="mt-8 space-y-5">
            {feature.benefits.map((b, i) => (
              <li key={b.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent font-heading text-sm font-bold text-accent-foreground"
                >
                  {i + 1}
                </span>
                <div>
                  <div className="font-heading font-bold">{b.title}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{b.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <CtaRow signupOpen={signupOpen} className="mt-8" />
        </div>

        <div className="rounded-2xl bg-accent p-4 sm:p-8">
          <Mock id={feature.heroMock} />
        </div>
      </div>

      {/* ---------- Zig-zag sections ---------- */}
      <div className="mt-20 space-y-20">
        {feature.sections.map((s, i) => {
          const mockFirst = i % 2 === 0
          return (
            <section
              key={s.title}
              className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
              aria-labelledby={`section-${i}`}
            >
              <div className={cn('rounded-2xl bg-accent/60 p-4 sm:p-8', mockFirst ? 'lg:order-1' : 'lg:order-2')}>
                <Mock id={s.mock} />
              </div>
              <div className={mockFirst ? 'lg:order-2' : 'lg:order-1'}>
                <h2 id={`section-${i}`} className="font-heading text-2xl font-bold tracking-tight text-balance sm:text-3xl">
                  {s.title}
                </h2>
                <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
                {s.link && (
                  <Link href={s.link.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline">
                    {s.link.label}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {/* ---------- Other features ---------- */}
      <section className="mt-20" aria-labelledby="other-features">
        <h2 id="other-features" className="label">Also on synapseHQ</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {others.map((o) => {
            const OIcon = o.icon
            return (
              <li key={o.slug}>
                <Link
                  href={`/features/${o.slug}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium shadow-[var(--shadow-sm)] hover:border-primary/60"
                >
                  <OIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
                  {o.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ---------- Closing CTA ---------- */}
      <div className="mt-16 rounded-2xl bg-accent px-6 py-10 text-center sm:px-10">
        <h2 className="font-heading text-2xl font-bold tracking-tight text-balance">{feature.claim}</h2>
        <p className="lede mx-auto mt-3">
          Every way of studying a set feeds the same memory of what you know — and every one is built for the answer in your own words.
        </p>
        <CtaRow signupOpen={signupOpen} className="mt-6 justify-center" ghostBrowse />
      </div>
    </article>
  )
}

function CtaRow({ signupOpen, className, ghostBrowse = false }: { signupOpen: boolean; className?: string; ghostBrowse?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {signupOpen ? (
        <>
          <Link href="/signup" className={cn(buttonVariants())}>Create an account</Link>
          <Link href="/login" className={cn(buttonVariants({ variant: 'ghost' }))}>Sign in</Link>
        </>
      ) : (
        <Link href="/login" className={cn(buttonVariants())}>Sign in</Link>
      )}
      <Link href="/browse" className={cn(buttonVariants({ variant: ghostBrowse ? 'ghost' : 'outline' }))}>
        Browse published sets
      </Link>
    </div>
  )
}
