import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { del } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/assets/[id]
 *
 * Authenticated asset proxy. Streams private blob content only to the owning user.
 * Supports HTTP Range requests for audio/video seeking.
 */
export async function GET(
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

  // Verify ownership. Assets always have an owning user, even before they are
  // linked to a set, so check the asset owner directly.
  if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch the blob from Vercel Blob using the storageKey (URL)
  try {
    const response = await fetch(asset.storageKey, {
      headers: request.headers.get('range') ? { range: request.headers.get('range')! } : {},
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 500 });
    }

    // Forward the response with proper headers
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', asset.mimeType);
    responseHeaders.set('Cache-Control', 'private, max-age=604800'); // 1 week, private
    responseHeaders.set('Content-Disposition', `inline; filename="${asset.originalName}"`);

    // Support Range requests (for audio/video seeking)
    if (response.headers.get('content-range')) {
      responseHeaders.set('Content-Range', response.headers.get('content-range')!);
      responseHeaders.set('Accept-Ranges', 'bytes');
    }

    // Stream the response
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
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
