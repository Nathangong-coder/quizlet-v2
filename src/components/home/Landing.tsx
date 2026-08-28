import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'

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
 * query.
 *
 * The sign-up link is GATED on `isSignupOpen()`: `/signup` calls `notFound()`
 * when the flag is off, so an unconditional link would be the front door
 * pointing at a 404. Signing IN is never gated, so that link is always shown.
 */
export function Landing() {
  const signupOpen = isSignupOpen()

  return (
    <div className="max-w-5xl mx-auto px-4 py-16 sm:py-24">
      <h1 className="display max-w-[18ch]">
        Recognising the answer is not knowing it.
      </h1>

      <p className="lede mt-6">
        Flashcards test whether you can pick the right answer out of a lineup. This
        app makes you write it — then grades what you actually wrote for
        correctness, clarity and concision, remembers which ideas you keep
        missing, and builds the next session out of them.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
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
        <Link
          href="/browse"
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          Browse published sets
        </Link>
      </div>

      <Section className="mt-16">
        <SectionHeader title="What it does" />
        <SectionBody>
          <div className="grid gap-8 sm:grid-cols-3">
            {/*
              Deliberately describes only what is BUILT. No voice interviews
              here — spoken practice is a later stage, and a landing page that
              advertises it would be the first thing the app got wrong.
            */}
            <div>
              <div className="label">Short answer</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Type the answer in your own words. It comes back with a grade per
                dimension and notes on the exact sentence that went wrong.
              </p>
            </div>
            <div>
              <div className="label">Memory that persists</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Every answer moves a confidence score and a review date. Sets you
                half-know resurface; sets you have mastered get out of the way.
              </p>
            </div>
            <div>
              <div className="label">Sets worth studying</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Import your own, or copy a published one into your account and
                edit it. Your copy is private and your progress is yours.
              </p>
            </div>
          </div>
        </SectionBody>
      </Section>
    </div>
  )
}
