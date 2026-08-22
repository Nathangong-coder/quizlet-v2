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
          // Swallow-and-finally, not catch-and-render: the response must be
          // identical for every input AND every outcome. There is deliberately
          // no error state — a second, distinct message would rebuild exactly
          // the enumeration oracle this form exists to avoid, and a transport
          // failure is not information the caller is entitled to.
          // NOTE: a bare try/finally (no catch) does NOT swallow the rejection
          // — it re-throws after finally, which crashes this transition and
          // unmounts the tree. The catch below is required and must stay empty.
          try {
            await requestPasswordReset({ identifier })
          } catch (error) {
            // deliberately empty — see note above. Logged locally only,
            // never surfaced in the UI: a browser console.error leaks
            // nothing to a remote caller, but a genuine client bug here
            // would otherwise fail silently.
            console.error('[forgot] request failed', error)
          } finally {
            setSent(true)
          }
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
