'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { completePasswordReset } from '@/actions/auth-reset'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        // Client-side only; the server does not need it. It exists to catch a
        // typo in a value the user cannot see.
        if (password !== confirm) {
          setError('Those passwords do not match.')
          return
        }
        startTransition(async () => {
          // Unlike ForgotForm/ResendVerification, this form's caller already
          // holds a valid token, so a specific error (expired link, weak
          // password) reveals nothing they did not already supply. But a
          // rejected promise (transport failure) must not be swallowed —
          // that would leave nothing rendered and an unhandled rejection.
          try {
            const res = await completePasswordReset({ token, password })
            if (!res.success) {
              setError(res.error)
              return
            }
            // The reset bumped sessionVersion, so any session this browser
            // held is already dead. Straight to /login with the confirmation.
            router.push('/login?reset=1')
            router.refresh()
          } catch {
            setError('Something went wrong. Please try again.')
          }
        })
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="reset-password" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="reset-password"
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
        <label htmlFor="reset-confirm" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input
          id="reset-confirm"
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
        {isPending ? 'Saving…' : 'Set my new password'}
      </Button>
    </form>
  )
}
