'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { loadTuning, saveTuning } from '@/actions/learner-tuning'
import { cn } from '@/lib/utils'

/**
 * Spec 6 §4: one switch, two sentences. Lives on /settings/study although,
 * unlike its neighbours, it feeds no computation yet — the setting decides
 * whether the picker is shown and whether the server keeps a rating.
 *
 * Saves ONLY `captureSelfRating` (`saveTuning` is partial), so flipping it
 * cannot revert a band, threshold, strategy or scope another panel wrote.
 */
export default function SelfRatingPanel() {
  const [on, setOn] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const result = await loadTuning()
      if (result.success) setOn(result.data.captureSelfRating)
      else toast.error(result.error)
      setLoading(false)
    })()
  }, [])

  async function toggle() {
    const next = !on
    setOn(next)
    setSaving(true)
    const result = await saveTuning({ captureSelfRating: next })
    setSaving(false)
    if (result.success) {
      setOn(result.data.captureSelfRating)
      toast.success(next ? 'Self-rating on' : 'Self-rating off')
    } else {
      setOn(!next)
      toast.error(result.error)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Self-rating</CardTitle>
        <CardDescription>
          Before you see feedback on an answer, one tap for how sure you are. Nothing here
          changes your scores; it records what you believed so the app can later compare
          your confidence with your results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <label htmlFor="capture-self-rating" className="text-sm font-medium">
            Ask how sure I am
          </label>
          <button
            id="capture-self-rating"
            type="button"
            role="switch"
            aria-checked={on}
            disabled={loading || saving}
            onClick={toggle}
            className={cn(
              'relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:opacity-60',
              on ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all',
                on ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Turning this off records nothing for the answers you give while it is off, and those
          ratings cannot be backfilled later.
        </p>
      </CardContent>
    </Card>
  )
}
