'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { savePassword } from '@/actions/password'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

export function PasswordPanel({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (next !== confirm) {
      setError('Those passwords do not match.')
      return
    }
    startTransition(async () => {
      const res = await savePassword({ current: hasPassword ? current : undefined, next })
      if (!res.success) {
        setError(res.error)
        return
      }
      setCurrent('')
      setNext('')
      setConfirm('')
      // Stated plainly, and true: raising sessionVersion invalidates the
      // acting token too, not just other devices. There is no session-update
      // round trip in this design to re-stamp it, so signing everyone out
      // including this tab is the safer default with no password reset to
      // fall back on. The action deliberately skips revalidatePath('/account')
      // for the same reason — we navigate away instead of racing a redirect.
      toast.success('Password saved. You have been signed out everywhere, including here.')
      router.push('/login?callbackUrl=%2Faccount')
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-3"
    >
      {hasPassword ? (
        <div className="space-y-1">
          <label htmlFor="current-password" className="text-sm font-medium">
            Current password
          </label>
          <Input
            id="current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="max-w-sm"
          />
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="new-password" className="text-sm font-medium">
          {hasPassword ? 'New password' : 'Password'}
        </label>
        <Input
          id="new-password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          className="max-w-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="confirm-password" className="text-sm font-medium">
          Confirm password
        </label>
        <Input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="max-w-sm"
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="sm"
        disabled={isPending || next.length === 0 || confirm.length === 0}
      >
        {isPending ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
      </Button>

      <p className="text-xs text-muted-foreground">
        At least {PASSWORD_MIN_LENGTH} characters. Saving this signs you out everywhere,
        including this device, so you&apos;ll need to sign in again right after. There is no
        password reset yet — if you forget it, GitHub is the only way back in.
      </p>
    </form>
  )
}
