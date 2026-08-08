import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { canReadSet } from '@/lib/sets/visibility';
import { del, get } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/assets/[id]
 *
 * Asset proxy. Streams private blob content to anyone who may read the SET the
 * asset appears on — its owner always, plus any viewer when that set is
 * link-shareable.
 *
 * NOTE: assets are stored with `access: 'private'`, so their blob URL is NOT
 * directly fetchable — a plain `fetch(url)` returns 403/404. We must use the
 * Vercel Blob `get()` helper, which authenticates server-side via the
 * BLOB_READ_WRITE_TOKEN and streams the private content back.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Deliberately NO early 401. A link-shared set is readable signed-out, and
  // its media has to be too — otherwise a shared set renders broken
  // placeholders for the exact audience share links exist for, with nothing on
  // screen explaining why.
  const session = await auth();
  const viewerId = session?.user?.id ?? null;

  const { id: assetId } = await params;
  if (!assetId) {
    return NextResponse.json({ error: 'Asset ID required' }, { status: 400 });
  }

  const asset = await prisma.cardAsset.findUnique({
    where: { id: assetId },
    include: {
      // The asset reaches a set only through the block that renders it.
      //
      // Do NOT use `CardAsset.setId` instead: that records the set the asset
      // was UPLOADED for, not where it is USED. An asset uploaded against set
      // A but placed on a card in set B would be judged by A's visibility
      // while rendering inside B — readable when it should not be, or broken
      // when it should work.
      contentBlocks: {
        select: { card: { select: { set: { select: { userId: true, visibility: true } } } } },
        take: 1,
      },
    },
  });

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  // An asset not yet attached to any card has no set to consult — uploads
  // create the row before linking it, and the upload UI previews it — so the
  // owner check is the only correct rule there.
  const set = asset.contentBlocks[0]?.card?.set ?? null;
  const allowed = set
    ? canReadSet(set, viewerId)
    : viewerId !== null && asset.userId === viewerId;

  // 404 for both "absent" and "denied": a distinguishable 403 confirms the
  // asset exists to someone probing ids. This deliberately replaces the
  // previous 401/403 split.
  if (!allowed) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  // Shared to everyone, or only to its owner? Asking `canReadSet(set, null)`
  // is asking "would an anonymous stranger get this?", which is exactly the
  // question a cache directive answers.
  const shared = set !== null && canReadSet(set, null);

  // Read the private blob through the authenticated Vercel Blob client.
  try {
    const result = await get(asset.storageKey, { access: 'private' });

    if (!result || result.statusCode !== 200 || !result.stream) {
      console.error('Blob get returned no content for asset', assetId);
      return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 404 });
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', asset.mimeType || result.blob.contentType || 'application/octet-stream');
    // A shared asset served `private` is refetched per viewer for no benefit;
    // an owner-only asset served `public` could be cached by a shared proxy,
    // which is precisely the leak this route exists to prevent.
    responseHeaders.set(
      'Cache-Control',
      shared ? 'public, max-age=604800' : 'private, max-age=604800',
    ); // 1 week
    responseHeaders.set('Content-Disposition', `inline; filename="${asset.originalName}"`);
    if (result.blob.size != null) {
      responseHeaders.set('Content-Length', String(result.blob.size));
    }

    return new NextResponse(result.stream, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Error fetching asset:', error);
    return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 500 });
  }
}

/**
 * DELETE /api/assets/[id]
 *
 * Delete an asset (owner only).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: assetId } = await params;
  if (!assetId) {
    return NextResponse.json({ error: 'Asset ID required' }, { status: 400 });
  }

  // Load asset and verify ownership
  const asset = await prisma.cardAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  // Verify ownership via the asset owner directly.
  if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Delete from Vercel Blob
    await del(asset.storageKey);

    // Delete from database
    await prisma.cardAsset.delete({ where: { id: assetId } });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting asset:', error);
    return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 });
  }
}
