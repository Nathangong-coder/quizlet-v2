'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { resetQuizAttempt } from '@/actions/memory'

const CONFIRM_PHRASE = 'DELETE'

/**
 * Erases one quiz outright — attempt, answers, session, and the memory events
 * they produced. Behind a typed confirmation rather than a `confirm()`: this
 * deletes graded work permanently and there is no undo.
 */
export function ResetQuizButton({ attemptId }: { attemptId: string; setId?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    const result = await resetQuizAttempt(attemptId)
    setBusy(false)
    // Early return, not `if (result.success && ...)`: ActionResult is a
    // discriminated union, so `error` only narrows inside the failure arm.
    if (!result.success) {
      toast.error(result.error || 'Failed to reset this quiz')
      return
    }
    toast.success('Quiz erased')
    // The quiz this page renders no longer exists, so staying here would
    // 404 on refresh. `erase` revalidates /profile, so the destination is
    // already rebuilt without this attempt.
    router.push('/profile')
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="w-4 h-4 mr-1" /> Reset this quiz
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
      <p className="text-sm text-muted-foreground">
        This permanently deletes this quiz, every answer in it, and the confidence
        and knowledge those answers contributed. Your other quizzes are unaffected.
        This cannot be undone.
      </p>
      <label htmlFor="reset-quiz-confirm" className="block text-sm font-medium">
        Type {CONFIRM_PHRASE} to confirm
      </label>
      <Input
        id="reset-quiz-confirm"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        autoComplete="off"
      />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={phrase !== CONFIRM_PHRASE || busy}
          onClick={run}
        >
          {busy ? 'Erasing…' : 'Delete'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false)
            setPhrase('')
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
