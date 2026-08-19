'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  OAuthAccountNotLinked:
    'That email already has an account here. Sign in with your password instead, then link GitHub later.',
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
        setError(messageFor(res.error))
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
