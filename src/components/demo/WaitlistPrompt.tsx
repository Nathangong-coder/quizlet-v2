'use client'

import Link from 'next/link'
import { useState } from 'react'
import { requestInvite } from '@/actions/demo'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { DemoFeature } from '@/lib/demo/config'
import type { DemoRefusal } from '@/lib/demo/guard'

/** Why the prompt opened: a guest limit, a used feature, a server refusal, or the shell's own button. */
export type WaitlistReason = 'cards' | 'sets' | 'quizzes' | 'questions' | 'invite' | DemoFeature | DemoRefusal

const LIMITS: ReadonlySet<WaitlistReason> = new Set<WaitlistReason>(['cards', 'sets', 'quizzes', 'questions'])

function heading(reason: WaitlistReason): string {
  if (reason === 'demo_cap') return 'The demo is busy today'
  if (LIMITS.has(reason)) return "You've reached the demo's limit"
  if (reason === 'invite' || reason === 'demo_off' || reason === 'run_not_started') return 'Request an invite'
  // quota_used and every DemoFeature.
  return "You've used your free try of this"
}

const ADDS = ['Unlimited quizzes.', 'Memory that brings back what you miss.', 'Key points tested properly on your own cards.']

// A convenience check, so a typo is caught without a round trip. The server
// (normalizeEmail) is the one that decides.
const looksLikeEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

/**
 * "Request an invite": what an account adds, and an email field that puts the
 * guest on the waitlist. A centred dialog on desktop, a bottom sheet on a phone.
 */
export function WaitlistPrompt({ open, onOpenChange, reason }: { open: boolean; onOpenChange: (o: boolean) => void; reason: WaitlistReason }) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    const trimmed = email.trim()
    if (!looksLikeEmail(trimmed)) return setError('Enter a valid email address.')
    setError(null)
    setPending(true)
    try {
      const res = await requestInvite(note.trim() ? { email: trimmed, note: note.trim() } : { email: trimmed })
      if (res.ok) setDone(true)
      else setError(res.message)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => onOpenChange(o)}>
      <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{heading(reason)}</DialogTitle>
          <DialogDescription>Sign-up is by invite. An account adds:</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {ADDS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {done ? (
          <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm font-medium">
            {/* One text for every success: the server doesn't say whether the email was new (R30). */}
            You&apos;re on the list. We&apos;ll email you an invite.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3" noValidate>
            <div className="space-y-1">
              <Label htmlFor="waitlist-email">Email</Label>
              <Input
                id="waitlist-email"
                type="email"
                autoComplete="email"
                value={email}
                maxLength={254}
                aria-invalid={error ? true : undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="waitlist-note">
                What are you preparing for? <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea id="waitlist-note" value={note} maxLength={200} rows={2} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              Request an invite
            </Button>
          </form>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Already have an invite?{' '}
          <Link href="/signup" className="underline underline-offset-4 hover:text-foreground">
            Sign up
          </Link>
          {' · '}
          <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  )
}
