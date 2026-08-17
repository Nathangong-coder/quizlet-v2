'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveHandle, saveContactEmail, saveEmailUpdates } from '@/actions/account'
import { HANDLE_MAX_LENGTH } from '@/lib/users/handle'

/**
 * Each panel owns ONE field and calls its own action.
 *
 * No shared form, no shared submit. See `src/actions/account.ts` for why:
 * the `/settings/ai` panels share a row and needed a live gate to prove a save
 * of one does not revert the others. Here the separation is structural.
 */

export function HandlePanel({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? '')
  const [saved, setSaved] = useState(initial)
  const [isPending, startTransition] = useTransition()

  const dirty = value.trim() !== (saved ?? '')

  function submit() {
    startTransition(async () => {
      const res = await saveHandle(value)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      setSaved(res.data.handle)
      setValue(res.data.handle)
      toast.success('Handle saved')
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground" aria-hidden="true">
          @
        </span>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={HANDLE_MAX_LENGTH}
          placeholder="your_handle"
          aria-label="Handle"
          className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={isPending || !dirty}>
          {isPending ? 'Saving…' : saved ? 'Update' : 'Set handle'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Letters, numbers and underscores. This is the name shown on sets you publish —
        your account name stays private.
      </p>
    </form>
  )
}

export function ContactEmailPanel({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? '')
  const [saved, setSaved] = useState(initial ?? '')
  const [isPending, startTransition] = useTransition()

  const dirty = value.trim() !== saved

  function submit() {
    startTransition(async () => {
      const res = await saveContactEmail(value)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      setSaved(value.trim())
      toast.success(value.trim() ? 'Contact email saved' : 'Contact email cleared')
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="you@example.com"
          aria-label="Contact email"
          className="max-w-sm"
        />
        <Button type="submit" size="sm" disabled={isPending || !dirty}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional, and separate from the account email above. Leave it empty to remove it.
      </p>
    </form>
  )
}

export function EmailUpdatesPanel({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  const [isPending, startTransition] = useTransition()

  function toggle(next: boolean) {
    const previous = enabled
    setEnabled(next)
    startTransition(async () => {
      const res = await saveEmailUpdates(next)
      if (!res.success) {
        // Explicit revert. Without it the control shows a state the database
        // does not have, and the user believes they unsubscribed.
        setEnabled(previous)
        toast.error(res.error)
        return
      }
      toast.success(next ? 'Signed up for updates' : 'Unsubscribed')
    })
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={isPending}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <span className="text-sm">Email me product updates</span>
      </label>
      {/*
        Stated plainly rather than implied. Nothing sends yet — Stage 7 deferred
        delivery and no mail provider is configured — so a checkbox with no note
        would be a promise the app does not keep. Recording the preference now
        is still worth doing: it is the half of that deferral the schema can
        honestly hold.
      */}
      <p className="text-xs text-muted-foreground">
        We aren&apos;t sending anything yet. This records your preference for when updates launch.
      </p>
    </div>
  )
}
