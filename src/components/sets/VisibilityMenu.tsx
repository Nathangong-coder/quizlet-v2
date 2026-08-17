'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, Link2, Lock } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { setSetVisibility } from '@/actions/sets'
import { SET_VISIBILITIES, type SetVisibility } from '@/lib/sets/visibility'
import { cn } from '@/lib/utils'

/**
 * How each visibility presents. `trigger` is the one-word state on the closed
 * control; `label` and `hint` are the expanded option.
 *
 * The trigger word is the SHORT one on purpose. It is the only thing visible
 * when the menu is closed, so it has to read as a state at a glance — "Private"
 * / "Shared", not a sentence about who may do what. The sentence is one click
 * away, at the point of change, which is where a decision about who can see
 * your work actually gets made.
 */
const OPTIONS: Record<SetVisibility, { trigger: string; label: string; hint: string }> = {
  private: {
    trigger: 'Private',
    label: 'Only me',
    hint: 'Nobody else can open this set.',
  },
  link: {
    trigger: 'Shared',
    label: 'Anyone with the link',
    hint: 'They can view and study it, but not edit it — and their progress stays their own.',
  },
}

/**
 * Owner-only control for who can read this set, as a dropdown at the top of the
 * Edit screen.
 *
 * This replaces the `VisibilityToggle` panel that used to sit under the set's
 * title. Visibility is changed rarely and was occupying the block directly
 * beneath the heading on every visit; the activities took that slot. Editing is
 * where the other rarely-changed properties of a set already live.
 *
 * Saves immediately rather than joining the form's Save button. `setSetVisibility`
 * is its own action against its own column, and folding it into the card-list
 * submit would mean a visibility change could be lost by a validation error in
 * an unrelated card — or applied by someone who then abandoned the edit.
 */
export default function VisibilityMenu({
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
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function choose(next: SetVisibility) {
    setOpen(false)
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
    // Built from `setId`, NOT `window.location.href`. This control now lives on
    // /sets/<id>/edit, so copying the current address would hand out an edit URL
    // — which the recipient cannot open — instead of the set. The old panel sat
    // on the set page itself, where the two happened to coincide.
    const url = `${window.location.origin}/sets/${setId}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      // Clipboard access is denied in some browsers and over plain HTTP.
      toast.error(`Could not copy — the link is ${url}`)
    }
  }

  const Icon = current === 'link' ? Link2 : Lock

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Visible to</span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={isPending}
          aria-label={`Who can see this set: ${OPTIONS[current].label}`}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-60',
            current === 'link'
              ? 'border-primary/40 bg-accent text-accent-foreground'
              : 'border-input hover:bg-muted',
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium">{OPTIONS[current].trigger}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </PopoverTrigger>

        <PopoverContent className="w-80">
          <div role="group" aria-label="Who can see this set">
            {SET_VISIBILITIES.map((option) => {
              const selected = current === option
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left',
                    'transition-colors hover:bg-muted focus-visible:outline-none focus-visible:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input',
                    )}
                    aria-hidden="true"
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{OPTIONS[option].label}</span>
                    {/*
                      Stated at the point of change, not in a tooltip or a help
                      page. What a share link does and does not grant is not
                      guessable: people reasonably assume sharing means either
                      nothing or everything.
                    */}
                    <span className="block text-xs text-muted-foreground">
                      {OPTIONS[option].hint}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>

      {current === 'link' && (
        <button
          type="button"
          onClick={copyLink}
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Copy link
        </button>
      )}
    </div>
  )
}
