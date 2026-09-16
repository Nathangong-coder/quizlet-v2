'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Globe, Link2, Lock, Share2 } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { buttonVariants } from '@/components/ui/button'
import { setSetVisibility } from '@/actions/sets'
import { SET_VISIBILITIES, type SetVisibility } from '@/lib/sets/visibility'
import { cn } from '@/lib/utils'

/**
 * Share, on the set page itself.
 *
 * Visibility used to live only on the Edit screen, so "how do I send this to
 * someone" meant finding Edit, then a dropdown, then copying the address bar.
 * Now: one button in the header. For the OWNER it shows the current state,
 * switches it inline, and copies the link. For a READER on a link/public set
 * it copies the link — a reader cannot change visibility, and cannot reach a
 * private set to see this button at all.
 *
 * The visibility copy is duplicated from `VisibilityMenu` rather than shared:
 * that menu's trigger is a one-word STATE for the Edit screen; this one's is
 * an ACTION. Same `setSetVisibility`, same optimistic-with-revert pattern.
 */
const OPTIONS: Record<SetVisibility, { label: string; hint: string; icon: typeof Lock }> = {
  private: { label: 'Only me', hint: 'Nobody else can open this set.', icon: Lock },
  link: { label: 'Anyone with the link', hint: 'They can view and study it, not edit it.', icon: Link2 },
  public: { label: 'Public, listed in Browse', hint: 'Credited to your handle. Anyone can study it or copy it.', icon: Globe },
}

const SAVED_MESSAGE: Record<SetVisibility, string> = {
  private: 'This set is now private',
  link: 'Anyone with the link can now see this set',
  public: 'This set is now listed in Browse',
}

/** The shareable address for a set, from the page it is rendered on. */
export function shareUrl(setId: string, origin: string): string {
  return `${origin}/sets/${setId}`
}

export function ShareButton({
  setId,
  visibility,
  isOwner,
}: {
  setId: string
  visibility: SetVisibility
  isOwner: boolean
}) {
  const [current, setCurrent] = useState<SetVisibility>(visibility)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  // A reader on a private set never sees this (they cannot open the set), and
  // an owner on a private set gets the menu — the point of which is to make it
  // shareable. So the only case with nothing to do is a reader + private,
  // which is unreachable; guard anyway so a future call site cannot render a
  // copy button for an address that 404s.
  if (!isOwner && current === 'private') return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl(setId, window.location.origin))
      setCopied(true)
      toast.success('Link copied')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy — select the address bar instead')
    }
  }

  function choose(next: SetVisibility) {
    if (next === current || isPending) return
    const previous = current
    setCurrent(next)
    startTransition(async () => {
      const result = await setSetVisibility(setId, next)
      if (!result.success) {
        setCurrent(previous)
        toast.error(result.error)
        return
      }
      toast.success(SAVED_MESSAGE[result.data.visibility])
    })
  }

  if (!isOwner) {
    return (
      <button type="button" onClick={copy} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}>
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Share2 className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? 'Copied' : 'Share'}
      </button>
    )
  }

  const Icon = OPTIONS[current].icon

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
        aria-label={`Share — currently ${OPTIONS[current].label}`}
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
        Share
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="label px-2 pb-1 pt-1">Who can open this set</div>
        <ul role="listbox" aria-label="Visibility" className="space-y-0.5">
          {SET_VISIBILITIES.map((v) => {
            const o = OPTIONS[v]
            const OIcon = o.icon
            const selected = v === current
            return (
              <li key={v}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={isPending}
                  onClick={() => choose(v)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm',
                    selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                >
                  <OIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                  {selected && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 border-t border-border pt-2">
          <button
            type="button"
            onClick={copy}
            disabled={current === 'private'}
            title={current === 'private' ? 'Choose a sharing option first' : undefined}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm',
              current === 'private' ? 'cursor-not-allowed text-muted-foreground/60' : 'hover:bg-muted',
            )}
          >
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy link'}
            <Icon className="ml-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
