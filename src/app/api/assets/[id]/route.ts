import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { del, get } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/assets/[id]
 *
 * Authenticated asset proxy. Streams private blob content only to the owning user.
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

  // Verify ownership. Assets always have an owning user, even before they are
  // linked to a set, so check the asset owner directly.
  if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Read the private blob through the authenticated Vercel Blob client.
  try {
    const result = await get(asset.storageKey, { access: 'private' });

    if (!result || result.statusCode !== 200 || !result.stream) {
      console.error('Blob get returned no content for asset', assetId);
      return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 404 });
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', asset.mimeType || result.blob.contentType || 'application/octet-stream');
    responseHeaders.set('Cache-Control', 'private, max-age=604800'); // 1 week, private
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
