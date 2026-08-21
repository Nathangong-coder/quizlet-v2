'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signUp } from '@/actions/auth-signup'
import { HANDLE_MAX_LENGTH } from '@/lib/users/handle'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

export default function SignUpForm() {
  const router = useRouter()
  const [inviteCode, setInviteCode] = useState('')
  const [handle, setHandle] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    // Checked on the client only — the server does not need it. The two fields
    // exist to catch a typo in the password before it is stored — cheaper than
    // a reset round trip.
    if (password !== confirm) {
      setError('Those passwords do not match.')
      return
    }

    startTransition(async () => {
      const res = await signUp({ handle, email, password, inviteCode })
      if (!res.success) {
        setError(res.error)
        return
      }
      // No auto-sign-in any more: the account is unverified, and
      // authorizeCredentials refuses an unverified credentials account. Send
      // them to the screen that shows the address they typed instead — that is
      // the primary typo defence, and it works better than the email itself,
      // because they see `me@gmial.com` while they still remember typing it.
      router.push(`/signup/check-email?email=${encodeURIComponent(res.data.email)}`)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="signup-invite" className="text-sm font-medium">
          Invite code
        </label>
        <Input
          id="signup-invite"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          autoComplete="off"
          placeholder="ABCDE-FG234"
        />
        <p className="text-xs text-muted-foreground">
          Hyphens, spaces and letter case do not matter.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="signup-handle" className="text-sm font-medium">
          Handle
        </label>
        <Input
          id="signup-handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          maxLength={HANDLE_MAX_LENGTH}
          autoComplete="username"
          placeholder="your_handle"
        />
        <p className="text-xs text-muted-foreground">
          Letters, numbers and underscores. This is the name others see.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="signup-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="signup-password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          At least {PASSWORD_MIN_LENGTH} characters. Length matters more than symbols.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="signup-confirm" className="text-sm font-medium">
          Confirm password
        </label>
        <Input
          id="signup-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Creating…' : 'Create account'}
      </Button>
    </form>
  )
}
