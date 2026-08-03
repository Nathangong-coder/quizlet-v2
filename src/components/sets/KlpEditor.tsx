'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { KLP_KINDS } from '@/lib/ai/schemas'
import { getCardKlps, saveCardKlp, retryKlpExtraction } from '@/actions/klp'
import { toast } from 'sonner'

interface Klp {
  id: string
  index: number
  text: string
  weight: number
  kind: string
}

/**
 * Per-card KLP panel in the set builder. Collapsed by default and loaded on
 * expand — a 100-card set must not fire 100 queries on page load.
 */
export function KlpEditor({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [klps, setKlps] = useState<Klp[]>([])
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true)
    const res = await getCardKlps(cardId)
    setBusy(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to load learning points')
      return
    }
    setStatus(res.data.status)
    setKlps(res.data.klps)
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && status === null) void load()
  }

  function patch(id: string, changes: Partial<Klp>) {
    setKlps((prev) => prev.map((k) => (k.id === id ? { ...k, ...changes } : k)))
  }

  async function save(klp: Klp) {
    const res = await saveCardKlp(klp.id, {
      text: klp.text,
      weight: klp.weight,
      kind: klp.kind,
    })
    // Early return, not `if (res.success && ...)`: ActionResult is a
    // discriminated union, so `res.error` only narrows inside the failure arm.
    if (!res.success) {
      toast.error(res.error || 'Failed to save')
      return
    }
    toast.success('Learning point saved')
    // MUST reload. A save supersedes every live CardKlp row for this card and
    // writes version n+1 with NEW ids, and saveCardKlp only accepts a row with
    // `supersededAt: null`. Without this the component's state still holds the
    // pre-save ids, so saving a second point — or re-saving this one after
    // another typo fix — fails with 'Not found' until a full page reload.
    // `revalidatePath` cannot fix that: it does not reset a client component's
    // useState, and `toggle()` only calls `load()` while `status === null`.
    // `load()` owns its own busy flag and clears it on both arms.
    await load()
  }

  async function retry() {
    setBusy(true)
    const res = await retryKlpExtraction(cardId)
    // Early return, not `if (res.success && ...)`: ActionResult is a
    // discriminated union, so `res.error` only narrows inside the failure arm.
    if (!res.success) {
      setBusy(false)
      toast.error(res.error || 'Failed to re-analyze this card')
      return
    }
    await load()
  }

  return (
    <div className="mt-3 border-t pt-3">
      <button type="button" onClick={toggle} className="text-sm text-muted-foreground underline">
        {open ? 'Hide' : 'Show'} key learning points
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {busy && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!busy && status === 'pending' && (
            <p className="text-sm text-muted-foreground">Analyzing this card…</p>
          )}

          {!busy && status === 'skipped' && (
            <p className="text-sm text-muted-foreground">
              Add an AI key in Settings to analyze this card.
            </p>
          )}

          {!busy && status === 'failed' && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Analysis failed for this card.</p>
              <Button type="button" variant="outline" size="sm" onClick={retry}>
                Retry
              </Button>
            </div>
          )}

          {!busy &&
            status === 'ready' &&
            klps.map((klp) => (
              <div key={klp.id} className="flex flex-wrap items-center gap-2">
                <Input
                  value={klp.text}
                  onChange={(e) => patch(klp.id, { text: e.target.value })}
                  className="flex-1 min-w-[16rem]"
                />
                <select
                  value={klp.kind}
                  onChange={(e) => patch(klp.id, { kind: e.target.value })}
                  className="border rounded px-2 py-1 text-sm"
                >
                  {KLP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <select
                  value={klp.weight}
                  onChange={(e) => patch(klp.id, { weight: Number(e.target.value) })}
                  className="border rounded px-2 py-1 text-sm"
                  title="How central this point is to the card"
                >
                  {[1, 2, 3, 4, 5].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={() => save(klp)}>
                  Save
                </Button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
