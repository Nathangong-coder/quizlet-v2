'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requestPasswordReset, FORGOT_FIXED_MESSAGE } from '@/actions/auth-reset'

/**
 * One outcome. No error branch, no "we couldn't find that account" — either
 * would rebuild the enumeration oracle the action exists to close.
 */
export default function ForgotForm() {
  const [identifier, setIdentifier] = useState('')
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (sent) {
    return (
      <p className="text-sm text-foreground" role="status">
        {FORGOT_FIXED_MESSAGE}
      </p>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          await requestPasswordReset({ identifier })
          setSent(true)
        })
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="forgot-identifier" className="text-sm font-medium">
          Email or handle
        </label>
        <Input
          id="forgot-identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Sending…' : 'Send a reset link'}
      </Button>
    </form>
  )
}
