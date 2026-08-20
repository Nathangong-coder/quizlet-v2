'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { savePassword } from '@/actions/password'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

export function PasswordPanel({ hasPassword }: { hasPassword: boolean }) {
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
      // Stated plainly: the bump signs every other session out, and a person
      // who is not told that will read it as a bug.
      toast.success('Password saved. Other devices have been signed out.')
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

      <Button type="submit" size="sm" disabled={isPending || next.length === 0}>
        {isPending ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
      </Button>

      <p className="text-xs text-muted-foreground">
        At least {PASSWORD_MIN_LENGTH} characters. There is no password reset yet — if you
        forget it, GitHub is the only way back in.
      </p>
    </form>
  )
}
