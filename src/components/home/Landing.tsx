import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { FeatureShowcase } from '@/components/home/FeatureShowcase'

/**
 * The signed-out first screen.
 *
 * It replaces what a new visitor used to get: `redirect('/sets')` followed by
 * "Sign in to see your sets" — a page that describes an empty container
 * belonging to an account they do not have, and says nothing about what the
 * app is for.
 *
 * NO DATA FETCHING. This renders for every anonymous hit including crawlers,
 * so it must not be a database read. `isSignupOpen()` is an env lookup, not a
 * query. `tests/components/landing.test.tsx` scans this file and the showcase
 * for a `@/lib/db` or `@prisma` import so the rule cannot rot quietly.
 *
 * The sign-up link is GATED on `isSignupOpen()`: `/signup` calls `notFound()`
 * when the flag is off, so an unconditional link would be the front door
 * pointing at a 404. Signing IN is never gated, so that link is always shown.
 *
 * PUBLIC-FACING. Everything here describes WHAT the app does, at the altitude
 * a learner cares about, and only what is BUILT. No voice — spoken practice
 * is a later stage, and a landing page that advertises it would be the first
 * thing the app got wrong. And nothing about HOW: the authoring pipeline, the
 * scoring model, and the model roster are not for this page.
 */
export function Landing() {
  const signupOpen = isSignupOpen()

  return (
    <div className="py-12 sm:py-16">
      {/* ---------- Hero ---------- */}
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="display mx-auto max-w-[20ch]">
          Recognising the answer is not knowing it.
        </h1>

        <p className="lede mx-auto mt-6">
          Flashcards test whether you can pick the right answer out of a lineup. synapseHQ
          makes you write it — then reads what you wrote against the ideas the card actually
          teaches, tells you which one you missed and how, and builds your next session out of
          exactly that.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {signupOpen ? (
            <>
              <Link href="/signup" className={cn(buttonVariants())}>
                Create an account
              </Link>
              <Link href="/login" className={cn(buttonVariants({ variant: 'ghost' }))}>
                Sign in
              </Link>
            </>
          ) : (
            <Link href="/login" className={cn(buttonVariants())}>
              Sign in
            </Link>
          )}
          {/*
            The one link that works WITHOUT an account. A landing page whose every
            affordance is a login wall asks for a commitment before it has shown
            anything; /browse is a real page full of real material, so it is the
            strongest thing here and is deliberately not buried in body copy.
          */}
          <Link href="/browse" className={cn(buttonVariants({ variant: 'outline' }))}>
            Browse published sets
          </Link>
        </div>
      </div>

      {/* ---------- Feature showcase (tabs) ---------- */}
      <Section className="mx-auto mt-20 max-w-5xl" rule={false}>
        <SectionHeader title="Seven ways to study one set" hint="every one of them feeds the same memory" action={<Link href="/features" className="underline underline-offset-4">All features</Link>} />
        <SectionBody>
          <FeatureShowcase />
        </SectionBody>
      </Section>

      {/* ---------- Why it is different ---------- */}
      <Section className="mx-auto max-w-5xl">
        <SectionHeader title="Why it works differently" />
        <SectionBody>
          <div className="grid gap-8 sm:grid-cols-3">
            <div>
              <div className="label">Ideas, not definitions</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Matching your words to a definition rewards paraphrase. Grading against the
                card&rsquo;s key points rewards the substance, and makes the feedback specific:
                &ldquo;you have the mechanism and missed the condition it depends on.&rdquo;
              </p>
            </div>
            <div>
              <div className="label">Mistakes with names</div>
              <p className="mt-2 text-sm text-muted-foreground">
                An error is not just a lost mark. It is an inversion, a conflation, a leap the
                answer never justified, an answer too thin to count — named from a fixed list, so
                the same mistake can be recognised when it comes back.
              </p>
            </div>
            <div>
              <div className="label">Honest memory</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Your confidence on each idea moves only on evidence, weighs a written answer more
                than a lucky guess, and says &ldquo;not enough evidence&rdquo; rather than inventing
                a number. Forget a card and the evidence is gone, not just the estimate.
              </p>
            </div>
          </div>
        </SectionBody>
      </Section>

      {/* ---------- How it goes ---------- */}
      <Section className="mx-auto max-w-5xl">
        <SectionHeader title="How it goes" />
        <SectionBody>
          <ol className="grid gap-6 sm:grid-cols-3">
            {[
              ['Bring your cards', 'Import a term|definition list, build a set by hand, or copy a published one. Your copy is private and your progress is yours.'],
              ['Study in your own words', 'Write the answer, or take a quick diagnostic across a subject. Every answer comes back with what you hit, what you missed, and why.'],
              ['Let the next session find you', 'What you missed, what is fading, and what you keep confusing become the plan. You open the app and the work is already chosen.'],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-sm font-bold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <div>
                  <div className="font-heading font-bold">{title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </SectionBody>
      </Section>

      {/* ---------- Closing CTA ---------- */}
      <div className="mx-auto mt-16 max-w-5xl rounded-2xl bg-accent px-6 py-10 text-center sm:px-10">
        <h2 className="font-heading text-2xl font-bold tracking-tight text-balance">
          Write the answer. See exactly what you missed.
        </h2>
        <p className="lede mx-auto mt-3">
          Built for finance interview prep first — short-answer practice with feedback that
          says which idea went wrong — and it works for anything you can put on a card.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {signupOpen ? (
            <Link href="/signup" className={cn(buttonVariants())}>
              Create an account
            </Link>
          ) : (
            <Link href="/login" className={cn(buttonVariants())}>
              Sign in
            </Link>
          )}
          <Link href="/browse" className={cn(buttonVariants({ variant: 'ghost' }))}>
            Browse published sets
          </Link>
        </div>
      </div>
    </div>
  )
}
