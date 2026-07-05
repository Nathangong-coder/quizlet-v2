
/**
 * Size caps for inline media in Gemini calls (in bytes).
 * Files larger than this fall back to text labels.
 */
const INLINE_SIZE_CAP = 4 * 1024 * 1024; // 4 MB

/**
 * Total request size budget for multimodal parts (text + inline media).
 * Gemini has request limits; enforce a per-request cap.
 */
const MAX_TOTAL_REQUEST_SIZE = 10 * 1024 * 1024; // 10 MB (conservative)

/**
 * Supported MIME types for Gemini `inlineData`.
 * Gemini supports images, audio, video, PDFs; we restrict to commonly useful ones.
 */
const SUPPORTED_INLINE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/wav',
  'audio/mp3',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/webm',
  'application/pdf',
]);

/**
 * Convert a CardAsset to a Gemini Part (either inlineData or null if too large).
 *
 * @param assetId Asset ID to convert
 * @returns Part with inlineData, or null if the asset is too large or unsupported
 * @throws if asset not found or access denied
 *
 * NOTE: This is a server-only function that requires auth and database access.
 */
export async function assetToPart(assetId: string): Promise<any> {
  // Dynamic import of server-only dependencies
  const { prisma } = await import('@/lib/db');
  const { auth } = await import('@/auth');

  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized: no session');
  }

  // Load asset and verify ownership via the asset owner directly.
  const asset = await prisma.cardAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  if (asset.userId !== session.user.id) {
    throw new Error('Forbidden: asset ownership mismatch');
  }

  // Check MIME type support
  if (!SUPPORTED_INLINE_MIMES.has(asset.mimeType)) {
    console.warn(`Unsupported MIME type for inline media: ${asset.mimeType}`);
    return null;
  }

  // Check size
  if (asset.sizeBytes > INLINE_SIZE_CAP) {
    console.warn(
      `Asset too large for inline media (${asset.sizeBytes} bytes > ${INLINE_SIZE_CAP} bytes): ${assetId}`,
    );
    return null;
  }

  // Fetch the blob from the storage URL
  try {
    const response = await fetch(asset.storageKey);
    if (!response.ok) {
      console.error(`Failed to fetch asset from blob storage: ${asset.storageKey}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return {
      inlineData: {
        mimeType: asset.mimeType,
        data: base64,
      },
    };
  } catch (error) {
    console.error(`Error fetching asset for multimodal: ${error}`);
    return null;
  }
}

/**
 * Memoize base64 conversions within a request to avoid double-fetching.
 * Use in a single request context (e.g., one grading call).
 */
export class MediaPartCache {
  private cache = new Map<string, any | null>();

  async getPart(assetId: string): Promise<any | null> {
    if (this.cache.has(assetId)) {
      return this.cache.get(assetId) || null;
    }

    const part = await assetToPart(assetId);
    this.cache.set(assetId, part);
    return part;
  }
}

/**
 * Check total request size and enforce budget.
 * Used to gate whether parts should be included.
 */
export function checkRequestBudget(
  parts: any[],
  textSize: number = 0,
): { isWithinBudget: boolean; totalSize: number } {
  let totalSize = textSize;

  for (const part of parts) {
    if (part && part.inlineData && part.inlineData.data) {
      // Estimate: base64 is ~4/3 of original, plus MIME type header
      const estimatedSize = (part.inlineData.data.length * 3) / 4 + 100;
      totalSize += estimatedSize;
    }
  }

  const isWithinBudget = totalSize <= MAX_TOTAL_REQUEST_SIZE;
  return { isWithinBudget, totalSize };
}
