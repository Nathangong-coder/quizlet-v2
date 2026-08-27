'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Flag } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { reportSet } from '@/actions/set-reports'
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_DETAIL_MAX,
  type ReportReason,
} from '@/lib/sets/moderation'
import { cn } from '@/lib/utils'

/**
 * Report a public set — a quiet text button that opens a Popover with the
 * closed reason vocabulary and an optional note.
 *
 * A Popover rather than `confirm()`/`alert()`: a blocking browser modal is
 * announced by the browser, not the app, cannot be styled or dismissed by
 * keyboard consistently, and — the reason `ActivityTiles` removed the last one
 * — steals focus out of the page. It also cannot carry a form, and a report
 * with no reason is a row an operator cannot act on.
 *
 * Deliberately understated. Reporting is rare and the control sits next to a
 * stranger's work; a loud red button invites use as a disagreement button.
 */
export default function ReportSetDialog({ setId }: { setId: string }) {
  const [open, setOpen] = useState(false)
  // No preselected reason. A default would be submitted unread by anyone who
  // clicks straight through, and every row an operator reads would say 'spam'.
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setReason(null)
    setDetail('')
  }

  function submit() {
    if (reason === null || isPending) return
    startTransition(async () => {
      const res = await reportSet(setId, reason, detail.trim() || undefined)
      if (!res.success) {
        // The popover stays OPEN on failure, holding what was typed. Closing it
        // would discard a written explanation the reporter cannot re-derive.
        toast.error(res.error || 'Could not send that report')
        return
      }
      setOpen(false)
      reset()
      toast.success('Thanks — an operator will take a look.')
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Discard a half-filled report on close rather than resurrecting it the
        // next time the button is pressed, possibly on a different visit.
        if (!next) reset()
      }}
    >
      <PopoverTrigger
        aria-label="Report this set"
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm',
          'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Report</span>
      </PopoverTrigger>

      <PopoverContent className="w-80">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Report this set</p>
            <p className="text-xs text-muted-foreground">
              This goes to an operator, not to the person who made it.
            </p>
          </div>

          <div role="radiogroup" aria-label="Reason for reporting">
            {REPORT_REASONS.map((option) => {
              const selected = reason === option
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setReason(option)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left',
                    'transition-colors hover:bg-muted focus-visible:outline-none focus-visible:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                    aria-hidden="true"
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 text-sm">{REPORT_REASON_LABELS[option]}</span>
                </button>
              )
            })}
          </div>

          <div className="space-y-1">
            <label htmlFor="report-detail" className="text-xs text-muted-foreground">
              Anything else? (optional)
            </label>
            <Textarea
              id="report-detail"
              value={detail}
              // Capped in the action too. This is a courtesy so the field stops
              // accepting text rather than silently discarding the tail.
              maxLength={REPORT_DETAIL_MAX}
              onChange={(e) => setDetail(e.target.value)}
              className="min-h-20 text-sm"
              placeholder="What should we look at?"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              // Disabled until a reason is chosen: the reason is the only part
              // of the row an operator can triage on.
              disabled={reason === null || isPending}
              onClick={submit}
            >
              {isPending ? 'Sending…' : 'Send report'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
