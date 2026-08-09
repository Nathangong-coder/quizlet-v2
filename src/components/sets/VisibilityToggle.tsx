'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { setSetVisibility } from '@/actions/sets'
import { SET_VISIBILITIES, type SetVisibility } from '@/lib/sets/visibility'
import { cn } from '@/lib/utils'

const LABELS: Record<SetVisibility, string> = {
  private: 'Only me',
  link: 'Anyone with the link',
}

/**
 * Owner-only control for who can read this set.
 *
 * Rendered only when `isOwner` — a non-owner must not see it at all, disabled
 * or otherwise. A disabled control still advertises that the capability
 * exists and invites people to ask why it is greyed out.
 */
export default function VisibilityToggle({
  setId,
  visibility,
}: {
  setId: string
  visibility: SetVisibility
}) {
  // Optimistic, with an explicit revert. Without the revert a rejected save
  // leaves the control showing a state the database does not have, which is
  // worse than showing nothing — the user believes their set is private.
  const [current, setCurrent] = useState<SetVisibility>(visibility)
  const [isPending, startTransition] = useTransition()

  function choose(next: SetVisibility) {
    if (next === current || isPending) return
    const previous = current
    setCurrent(next)

    startTransition(async () => {
      const res = await setSetVisibility(setId, next)
      if (!res.success) {
        setCurrent(previous)
        toast.error(res.error || 'Could not change who can see this set')
        return
      }
      toast.success(
        next === 'link' ? 'Anyone with the link can now see this set' : 'This set is now private',
      )
    })
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied')
    } catch {
      // Clipboard access is denied in some browsers and over plain HTTP. The
      // URL is in the address bar either way, so this is a nudge, not a
      // failure worth alarming anyone about.
      toast.error('Could not copy — you can copy the address bar instead')
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Who can see this set</p>
        <div className="flex flex-wrap gap-2">
          {SET_VISIBILITIES.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={current === option ? 'default' : 'outline'}
              disabled={isPending}
              onClick={() => choose(option)}
              aria-pressed={current === option}
            >
              {LABELS[option]}
            </Button>
          ))}
        </div>
      </div>

      {/*
        Stated at the point of change, not in a tooltip or a help page. What a
        share link does and does not grant is not guessable: people reasonably
        assume sharing means either nothing or everything.
      */}
      <p className={cn('text-xs text-muted-foreground', current !== 'link' && 'hidden')}>
        Anyone with the link can view and study this set. They can&apos;t edit it, and their
        progress stays their own.
      </p>

      {current === 'link' && (
        <Button type="button" size="sm" variant="secondary" onClick={copyLink}>
          Copy link
        </Button>
      )}
    </div>
  )
}
