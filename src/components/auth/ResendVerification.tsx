'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resendVerification, RESEND_FIXED_MESSAGE } from '@/actions/auth-verify'

/**
 * The response NEVER varies. There is deliberately no error state and no
 * success/failure branch here — a component that rendered one would reintroduce
 * the enumeration oracle the action exists to close.
 */
export default function ResendVerification({
  defaultIdentifier = '',
}: {
  defaultIdentifier?: string
}) {
  const [identifier, setIdentifier] = useState(defaultIdentifier)
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          await resendVerification({ identifier })
          setSent(true)
        })
      }}
      className="space-y-3"
    >
      <div className="space-y-1">
        <label htmlFor="resend-identifier" className="text-sm font-medium">
          Email or handle
        </label>
        <Input
          id="resend-identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
        />
      </div>

      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending ? 'Sending…' : 'Send another link'}
      </Button>

      {sent ? (
        <p className="text-sm text-muted-foreground" role="status">
          {RESEND_FIXED_MESSAGE}
        </p>
      ) : null}
    </form>
  )
}
