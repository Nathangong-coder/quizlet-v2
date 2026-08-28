'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { submitFeedback } from '@/actions/feedback'
import { FEEDBACK_LIMITS } from '@/lib/feedback/schema'

/**
 * The /help form.
 *
 * Prefilled from the account where possible, because "add your name and email"
 * is a question the app can already answer and asking it again reads as a form
 * that is not connected to anything. Both stay editable — the reply address is
 * not necessarily the account address.
 */
export function FeedbackForm({
  defaultName,
  defaultEmail,
}: {
  defaultName: string
  defaultEmail: string
}) {
  const [pending, start] = useTransition()
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')

  if (sent) {
    return (
      <div className="rounded-lg border bg-muted/40 p-6">
        <p className="font-medium">Thanks — we have it.</p>
        <p className="text-sm text-muted-foreground mt-1">
          Your message is stored and on its way. If it needs a reply, it goes to the address you
          gave.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setSent(false)}>
          Send another
        </Button>
      </div>
    )
  }

  return (
    <form
      className="space-y-5"
      action={(formData) => {
        start(async () => {
          const result = await submitFeedback({
            name: String(formData.get('name') ?? ''),
            email: String(formData.get('email') ?? ''),
            subject: String(formData.get('subject') ?? ''),
            message: String(formData.get('message') ?? ''),
          })
          if (result.success) {
            setSent(true)
            setMessage('')
          } else {
            toast.error(result.error)
          }
        })
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fb-name">Your name</Label>
          <Input id="fb-name" name="name" defaultValue={defaultName} maxLength={FEEDBACK_LIMITS.name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fb-email">Reply to</Label>
          <Input
            id="fb-email"
            name="email"
            type="email"
            defaultValue={defaultEmail}
            maxLength={FEEDBACK_LIMITS.email}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fb-subject">Subject</Label>
        <Input
          id="fb-subject"
          name="subject"
          placeholder="What is this about?"
          maxLength={FEEDBACK_LIMITS.subject}
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="fb-message">Your message</Label>
          {/* Shown only once it matters. A counter sitting at 0 / 4000 from the
              first render is noise about a limit nobody is near. */}
          {message.length > FEEDBACK_LIMITS.message * 0.75 && (
            <span className="font-mono text-xs text-muted-foreground">
              {message.length} / {FEEDBACK_LIMITS.message}
            </span>
          )}
        </div>
        <Textarea
          id="fb-message"
          name="message"
          rows={8}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={FEEDBACK_LIMITS.message}
          placeholder="What happened, and what did you expect instead?"
          required
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  )
}
