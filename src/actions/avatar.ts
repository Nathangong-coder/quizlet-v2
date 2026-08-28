'use server'

import { put, del } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { AVATAR_MAX_BYTES } from '@/lib/users/avatar'
import { verifyImageUpload } from '@/lib/users/image-sniff'
import type { ActionResult } from '@/types/action'

/**
 * EVERY EXPORT IN A `'use server'` FILE IS A PUBLIC ENDPOINT reachable by any
 * client, whatever the UI does. Both functions below therefore establish their
 * own identity from the session and never accept a user id — see the memory
 * note `use-server-exports-are-endpoints`, written after a refactor for code
 * reuse made an ungated structural write callable by anyone.
 */

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const

/**
 * Delete a previous avatar blob without ever failing the request that replaced
 * it. The new URL is already persisted by the time this runs; a leaked object
 * is a cost, whereas an error thrown here would surface as "your upload
 * failed" for an upload that plainly succeeded.
 */
async function discard(url: string | null | undefined) {
  if (!url) return
  try {
    await del(url)
  } catch (error) {
    console.error('[avatar] failed to delete previous blob', { error })
  }
}

export async function setAvatar(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { success: false, error: 'Sign in to change your picture.' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'Choose an image first.' }
  }

  // Size is checked BEFORE the bytes are read into memory. Reading first and
  // measuring after would let an arbitrarily large upload be buffered by the
  // very request that is about to reject it.
  if (file.size > AVATAR_MAX_BYTES) {
    return { success: false, error: 'That image is over 2 MB. Try a smaller one.' }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // The declared type is a string the CLIENT chose — on a browser File it is
  // derived from the filename extension, so renaming payload.txt to avatar.png
  // is enough to make it say image/png. The bytes are the only evidence.
  const verified = verifyImageUpload(bytes, file.type)
  if (!verified.ok) return { success: false, error: verified.reason }

  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  })

  const blob = await put(`avatars/${randomUUID()}.${EXTENSIONS[verified.type]}`, Buffer.from(bytes), {
    contentType: verified.type,
    // PRIVATE, because the store is. This was `access: 'public'` on the
    // reasoning that an avatar sits beside a published set and a private blob
    // would buy no privacy for the cost of a proxy hop — sound in the abstract,
    // and rejected by the API in practice:
    //
    //   Vercel Blob: Cannot use public access on a private store.
    //
    // That error WAS the bug: every photo upload failed with "server is down",
    // in a code path no test could see because the store's access mode is not
    // something a mock has. The bytes come back through `/api/avatar/[id]` now,
    // the same way card media comes back through `/api/assets/[id]`.
    //
    // Card assets stay private for a DIFFERENT reason — they carry set content
    // and are owner-checked on every fetch — so the two call sites still must
    // not be "made consistent" by copying a rule from one to the other. Last
    // session `access: 'public'` in the FORK copier was a real security bug.
    access: 'private',
  })

  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: blob.url } })

  // After the new URL is committed, so a failure here cannot orphan the record.
  await discard(previous?.avatarUrl)

  revalidatePath('/', 'layout')
  return { success: true, data: { url: blob.url } }
}

export async function removeAvatar(): Promise<ActionResult<null>> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { success: false, error: 'Sign in to change your picture.' }

  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  })

  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } })
  await discard(previous?.avatarUrl)

  revalidatePath('/', 'layout')
  return { success: true, data: null }
}
