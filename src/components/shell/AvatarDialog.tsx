'use client'

import { useState, useTransition, useRef } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { setAvatar, removeAvatar } from '@/actions/avatar'
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '@/lib/users/avatar'

/**
 * "Change photo", inside the profile menu.
 *
 * A separate target from the topbar avatar on purpose: that one opens the menu,
 * this one changes the picture. One control doing both means every attempt to
 * reach the menu is a near-miss on a file dialog.
 *
 * The size and type checks here are CONVENIENCE, not enforcement — they turn a
 * round trip into an instant message. `setAvatar` re-checks both server-side
 * and reads the actual bytes, because nothing a client says about a file is
 * evidence.
 */
export function AvatarDialog({ hasUpload }: { hasUpload: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function upload(file: File) {
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error('That image is over 2 MB. Try a smaller one.')
      return
    }
    const data = new FormData()
    data.set('file', file)
    start(async () => {
      const result = await setAvatar(data)
      if (result.success) {
        toast.success('Picture updated.')
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
        Change photo
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your picture</DialogTitle>
          <DialogDescription>
            PNG, JPEG or WebP, up to 2 MB. Without one you get a generated mark, which is
            already unique to your account.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          className="block w-full text-sm text-muted-foreground
                     file:mr-3 file:rounded-md file:border file:border-input file:bg-background
                     file:px-3 file:py-1.5 file:text-sm file:text-foreground
                     hover:file:bg-accent"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload(file)
          }}
        />

        <DialogFooter>
          {hasUpload && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await removeAvatar()
                  if (result.success) {
                    toast.success('Back to your generated mark.')
                    setOpen(false)
                  } else {
                    toast.error(result.error)
                  }
                })
              }
            >
              Remove photo
            </Button>
          )}
          <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
            {pending ? 'Working…' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
