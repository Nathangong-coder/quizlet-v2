'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ArrowLeft, Check, Loader2, NotebookPen } from 'lucide-react'
import { createPostmortem, updatePostmortem } from '@/actions/postmortem'
import { POSTMORTEM_FORMATS, POSTMORTEM_FORMAT_LABELS } from '@/lib/postmortem/kinds'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

export interface PostmortemSetOption {
  id: string
  title: string
}

export interface PostmortemFormValues {
  title: string
  format: (typeof POSTMORTEM_FORMATS)[number]
  occurredAt: string
  setId: string
  durationMin: string
  confidence: string
  whatCameUp: string
  wins: string
  gaps: string
  nextSteps: string
}

const FIELD_LABEL = 'mb-1.5 block text-sm font-semibold text-foreground'
const FIELD_HINT = 'mb-2 text-xs leading-relaxed text-muted-foreground'

export function PostmortemForm({
  mode,
  postmortemId,
  sets,
  initial,
}: {
  mode: 'new' | 'edit'
  postmortemId?: string
  sets: PostmortemSetOption[]
  initial: PostmortemFormValues
}) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = mode === 'edit' && postmortemId
        ? await updatePostmortem(postmortemId, values)
        : await createPostmortem(values)

      if (!result.success) {
        setError(result.error)
        return
      }

      window.location.assign(`/postmortem/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7">
        <div className="mb-6 flex items-start gap-3 border-b border-border pb-5">
          <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
            <NotebookPen className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Set the scene</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              A few details make this useful when you look back before your next interview or test.
            </p>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="postmortem-title" className={FIELD_LABEL}>Name this session</label>
            <p className={FIELD_HINT}>Use something you will recognize later, like “Goldman Sachs first-round prep”.</p>
            <Input
              id="postmortem-title"
              value={values.title}
              onChange={(event) => setValues({ ...values, title: event.target.value })}
              placeholder="Give this session a name"
              maxLength={160}
              required
            />
          </div>

          <div>
            <label htmlFor="postmortem-format" className={FIELD_LABEL}>What kind of session was it?</label>
            <select
              id="postmortem-format"
              value={values.format}
              onChange={(event) => setValues({ ...values, format: event.target.value as PostmortemFormValues['format'] })}
              className="flex h-10 w-full min-w-0 rounded-[4px] border border-input bg-card px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              required
            >
              {POSTMORTEM_FORMATS.map((format) => (
                <option key={format} value={format}>{POSTMORTEM_FORMAT_LABELS[format]}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="postmortem-date" className={FIELD_LABEL}>When did it happen?</label>
            <Input
              id="postmortem-date"
              type="date"
              value={values.occurredAt}
              onChange={(event) => setValues({ ...values, occurredAt: event.target.value })}
              required
            />
          </div>

          <div>
            <label htmlFor="postmortem-set" className={FIELD_LABEL}>Connect a study set <span className="font-normal text-muted-foreground">(optional)</span></label>
            <select
              id="postmortem-set"
              value={values.setId}
              onChange={(event) => setValues({ ...values, setId: event.target.value })}
              className="flex h-10 w-full min-w-0 rounded-[4px] border border-input bg-card px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">No linked set</option>
              {sets.map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">Link context without turning this reflection into a scored activity.</p>
          </div>

          <div>
            <label htmlFor="postmortem-duration" className={FIELD_LABEL}>How long? <span className="font-normal text-muted-foreground">(optional)</span></label>
            <div className="relative">
              <Input
                id="postmortem-duration"
                type="number"
                min={1}
                max={1440}
                value={values.durationMin}
                onChange={(event) => setValues({ ...values, durationMin: event.target.value })}
                placeholder="45"
                className="pr-16"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">minutes</span>
            </div>
          </div>

          <div className="sm:col-span-2">
            <span className={FIELD_LABEL}>How did it feel? <span className="font-normal text-muted-foreground">(optional)</span></span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How did it feel?"><span className="sr-only">1 is rough, 5 is strong</span>
              {[1, 2, 3, 4, 5].map((score) => {
                const selected = values.confidence === String(score)
                return (
                  <button
                    key={score}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setValues({ ...values, confidence: selected ? '' : String(score) })}
                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
                  >
                    {score}
                  </button>
                )
              })}
              <span className="ml-1 self-center text-xs text-muted-foreground">rough → strong</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7">
        <div className="mb-6 border-b border-border pb-5">
          <h2 className="text-base font-semibold">Debrief the session</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Be concrete. The goal is to leave your future self a trail of what to revisit, not a perfect report.
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <label htmlFor="postmortem-came-up" className={FIELD_LABEL}>What came up?</label>
            <p className={FIELD_HINT}>Questions, topics, prompts, or moments you remember—especially the ones you want to keep connected to your interview prep.</p>
            <Textarea
              id="postmortem-came-up"
              value={values.whatCameUp}
              onChange={(event) => setValues({ ...values, whatCameUp: event.target.value })}
              placeholder="They asked me to walk through a DCF and defend my terminal growth assumption…"
              rows={4}
              maxLength={12000}
              required
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="postmortem-wins" className={FIELD_LABEL}>What went well? <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Textarea
                id="postmortem-wins"
                value={values.wins}
                onChange={(event) => setValues({ ...values, wins: event.target.value })}
                placeholder="I stayed calm on the market-sizing question…"
                rows={4}
                maxLength={12000}
              />
            </div>
            <div>
              <label htmlFor="postmortem-gaps" className={FIELD_LABEL}>Where did I feel a gap? <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Textarea
                id="postmortem-gaps"
                value={values.gaps}
                onChange={(event) => setValues({ ...values, gaps: event.target.value })}
                placeholder="I could not explain working-capital changes cleanly…"
                rows={4}
                maxLength={12000}
              />
            </div>
          </div>

          <div>
            <label htmlFor="postmortem-next-steps" className={FIELD_LABEL}>What is the next move? <span className="font-normal text-muted-foreground">(optional)</span></label>
            <p className={FIELD_HINT}>One or two actions are enough. You can turn these into linked cards and practice later.</p>
            <Textarea
              id="postmortem-next-steps"
              value={values.nextSteps}
              onChange={(event) => setValues({ ...values, nextSteps: event.target.value })}
              placeholder="Review working capital, then do two timed DCF walkthroughs…"
              rows={3}
              maxLength={12000}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" render={<Link href={mode === 'edit' && postmortemId ? `/postmortem/${postmortemId}` : '/postmortem'} /> }>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save postmortem'}
        </Button>
      </div>
    </form>
  )
}
