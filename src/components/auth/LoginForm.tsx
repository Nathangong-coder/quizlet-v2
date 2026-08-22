'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ResendVerification from '@/components/auth/ResendVerification'

/** The one message every credentials failure produces. See lib/auth/credentials.ts. */
const GENERIC_FAILURE = 'Email or password is incorrect.'

/**
 * Auth.js error codes that arrive as `?error=` on a redirect back here.
 *
 * `OAuthAccountNotLinked` is the one that matters: someone signed up with a
 * password and is now trying GitHub with the same address. Auth.js refuses by
 * design — auto-linking would trust a provider's unverified email claim — so
 * the fix is copy that explains the situation, not a config change.
 */
const ERROR_COPY: Record<string, string> = {
  CredentialsSignin: GENERIC_FAILURE,
  // `next-auth`'s CredentialsSignin base class defaults `error.code` to
  // "credentials" — Auth.js only puts a `code` query param on the redirect
  // AT ALL when the thrown error `instanceof CredentialsSignin`
  // (@auth/core/index.js), and for THAT family `error` (the `type`, from a
  // static class field) is always the fixed string "CredentialsSignin",
  // never anything more specific. The *subclass* signal lives in `code`, not
  // `error`. Confirmed empirically in Task 10 Step 6: signing in on an
  // unverified account produced `?error=CredentialsSignin&code=unverified`.
  // See `submit()` below, which looks up `res.code ?? res.error` for exactly
  // this reason.
  credentials: GENERIC_FAILURE,
  OAuthAccountNotLinked:
    'That email already has an account here. Sign in with your password instead.',
  unverified:
    'Your email address isn’t verified yet. Check your inbox for the link, or send another below.',
}

function messageFor(code: string): string {
  return ERROR_COPY[code] ?? 'Something went wrong signing you in. Please try again.'
}

export default function LoginForm({
  callbackUrl,
  signupOpen,
  initialError,
}: {
  callbackUrl: string
  signupOpen: boolean
  initialError?: string
}) {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    initialError ? messageFor(initialError) : null,
  )
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      // redirect:false so the failure lands here as a value rather than as a
      // navigation to Auth.js's own error page.
      const res = await signIn('credentials', { identifier, password, redirect: false })
      if (res?.error) {
        // `res.code` carries the CredentialsSignin subclass's specific code
        // ("unverified", or the base class's default "credentials"); every
        // other AuthError type (e.g. OAuthAccountNotLinked) never gets a
        // `code`, so `res.error` (the fixed type string) is the fallback.
        setError(messageFor(res.code ?? res.error))
        return
      }
      router.push(callbackUrl)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="login-identifier" className="text-sm font-medium">
            Email or handle
          </label>
          <Input
            id="login-identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="login-password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {/*
       * MUST be a sibling of <form>, not a child of it: ResendVerification
       * renders its own <form>, and HTML forbids a <form> descendant of
       * another <form> — nesting them here produced a real React hydration
       * error, caught empirically in Task 10 Step 6 via the dev overlay
       * ("In HTML, <form> cannot be a descendant of <form>").
       */}
      {error === ERROR_COPY.unverified ? <ResendVerification defaultIdentifier={identifier} /> : null}

      <p className="text-sm text-muted-foreground">
        <Link href="/forgot" className="underline hover:text-foreground">
          Forgot your password?
        </Link>
      </p>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => signIn('github', { callbackUrl })}
      >
        Continue with GitHub
      </Button>

      {signupOpen ? (
        <p className="text-sm text-muted-foreground">
          New here?{' '}
          <Link href="/signup" className="underline hover:text-foreground">
            Create an account
          </Link>
        </p>
      ) : null}
    </div>
  )
}
