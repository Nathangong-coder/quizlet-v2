import { prisma } from '@/lib/db'
import { get } from '@vercel/blob'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/avatar/[id]
 *
 * Streams a user's uploaded profile picture.
 *
 * WHY A PROXY FOR SOMETHING PUBLIC. Avatars used to be written with
 * `access: 'public'` and rendered straight from the blob URL. That is the right
 * shape in the abstract — an avatar sits beside a published set and is seen by
 * strangers, so a private blob buys no privacy — but the store this project
 * actually has is configured `private`, and the Blob API rejects a public write
 * to it outright:
 *
 *   Vercel Blob: Cannot use public access on a private store.
 *
 * That rejection was every "server is down" on the change-photo dialog. The
 * write is now private like every other object in the store, and this route is
 * what puts the bytes back on a plain <img src>.
 *
 * DELIBERATELY NO AUTH, and no owner check. Anyone who can see a set can see
 * whose set it is; gating the picture behind a session would blank the author's
 * face on exactly the link-shared pages sharing exists for. Nothing here reads
 * a session, so nothing here can leak one account's data to another: the id in
 * the path is the id of the person whose picture is being drawn.
 *
 * The response is IMMUTABLE-ish because the caller busts it: `avatarSrc`
 * appends `?v=<blob uuid>`, which changes on every upload. See its doc comment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id },
    // ONLY the avatar column. A `findUnique` here with a wider select would be
    // one careless spread away from serving an email address from an
    // unauthenticated endpoint.
    select: { avatarUrl: true },
  })

  // 404 for "no such user" and "no uploaded picture" alike. A caller that
  // reaches this route for someone using their OAuth image or a generated
  // glyph is asking for a file that does not exist, not hitting an error.
  if (!user?.avatarUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    // `get()` authenticates server-side with BLOB_READ_WRITE_TOKEN and accepts
    // the stored URL directly — the same call `/api/assets/[id]` makes against
    // `CardAsset.storageKey`, which is likewise a URL rather than a pathname.
    const result = await get(user.avatarUrl, { access: 'private' })
    if (!result || result.statusCode !== 200 || !result.stream) {
      console.error('[avatar] blob get returned no content', { id })
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const headers = new Headers()
    headers.set('Content-Type', result.blob.contentType || 'image/png')
    // A year, and `immutable`, because the URL carries the blob id: replacing
    // the picture produces a different URL rather than a stale cache entry.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    if (result.blob.size != null) headers.set('Content-Length', String(result.blob.size))

    return new NextResponse(result.stream, { status: 200, headers })
  } catch (error) {
    console.error('[avatar] failed to stream blob', { id, error })
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
