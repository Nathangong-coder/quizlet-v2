'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Sparkles, Loader2, CircleCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSetBuildStatus, runSetBuildStep } from '@/actions/klp-build'
import type { SetBuildStatus } from '@/lib/klp/build-set'

/**
 * The owner's key-points panel (2026-09-16). Shows what the set still needs
 * — cards to author, cards to mint, a tree to rebuild — and runs the build
 * one bounded step at a time until nothing is left. Steps are server
 * actions so the loop survives the platform's per-request limit; a page
 * reload just resumes from the stored state, because every card's status
 * lives on the card.
 *
 * AUTO-START. `updateSet` sends the owner back here with `?build=1` after a
 * save that changed a card's meaning, and this panel starts the build on
 * arrival — "as soon as they edit", without a job queue. It never
 * auto-starts otherwise: a viewer landing on their own set should not spend
 * budget by looking at it.
 */
export function KeyPointsBuild({ setId }: { setId: string }) {
  const params = useSearchParams()
  const [status, setStatus] = useState<SetBuildStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const stopRef = useRef(false)

  const refresh = useCallback(() => {
    return getSetBuildStatus(setId).then((res) => {
      if (res.success) setStatus(res.data)
    })
  }, [setId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setLastError(null)
    stopRef.current = false
    try {
      for (let i = 0; i < 400 && !stopRef.current; i++) {
        const res = await runSetBuildStep(setId)
        if (!res.success) { setLastError(res.error); break }
        const step = res.data
        setStatus(step.status)
        if (step.cards.length) setLog((l) => [`${step.did === 'author' ? 'Wrote key points for' : step.did === 'mint' ? 'Mapped topics for' : 'Rebuilt the concept tree from'} ${step.cards.length} card${step.cards.length === 1 ? '' : 's'}`, ...l].slice(0, 6))
        if (step.errors.length) {
          const kinds = [...new Set(step.errors.map((e) => e.kind))]
          setLastError(`${step.errors.length} card${step.errors.length === 1 ? '' : 's'} failed (${kinds.join(', ')})`)
          if (kinds.some((k) => k === 'quota_exhausted' || k === 'no_credentials' || k === 'credentials_unavailable')) break
        }
        if (step.did === 'nothing' || step.status.ready) break
        // a step that did nothing but still reports work means every remaining card failed this round
        if (step.cards.length === 0 && step.errors.length > 0) break
      }
    } finally {
      setRunning(false)
      refresh()
    }
  }, [running, setId, refresh])

  // arrive from a save → start
  const auto = params.get('build') === '1'
  const autoStarted = useRef(false)
  useEffect(() => {
    if (auto && status && !status.ready && !autoStarted.current) {
      autoStarted.current = true
      run()
    }
  }, [auto, status, run])

  if (!status) return null
  const pending = status.needAuthoring + status.needMinting + (status.needRebuild > 0 ? 1 : 0)
  if (status.ready && !running && log.length === 0) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-success" aria-hidden="true" />
        Key points and topics are built for every card.
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-lg border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {status.ready ? (
            <p className="font-medium">Built. Key points and topics are current for every card.</p>
          ) : (
            <p className="font-medium">
              {status.needAuthoring > 0 && `${status.needAuthoring} card${status.needAuthoring === 1 ? '' : 's'} need key points`}
              {status.needAuthoring > 0 && status.needMinting > 0 && ', '}
              {status.needMinting > 0 && `${status.needMinting} need topics`}
              {status.needAuthoring === 0 && status.needMinting === 0 && status.needRebuild > 0 && 'the concept tree needs rebuilding'}
            </p>
          )}
          <p className="text-muted-foreground">
            {running
              ? 'Building — each card is written, tested against wrong answers, and mapped into the concept tree. You can leave this page; it resumes where it stopped.'
              : status.ready
                ? ''
                : 'Runs on your AI credentials (or a key lent to you). About half a cent and a minute per card.'}
          </p>
        </div>
        {!status.ready && (
          <Button type="button" size="sm" onClick={running ? () => { stopRef.current = true } : run} disabled={false}>
            {running ? (<><Loader2 className="mr-1 size-4 animate-spin" />Stop after this step</>) : (pending > 0 && log.length ? 'Continue' : 'Build key points')}
          </Button>
        )}
      </div>
      {(lastError || log.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {lastError && (
            <li className="flex items-center gap-1 text-warning">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {lastError}
              {status.failed > 0 && ` · ${status.failed} card${status.failed === 1 ? '' : 's'} recorded an error; Build again retries them`}
            </li>
          )}
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
