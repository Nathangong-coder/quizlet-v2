"use server";

import { uploadAsset } from "@/lib/uploads";
import { prisma } from "@/lib/db";
import { auth } from '@/auth';
import { z } from "zod";
import { sniffAssetKind, parseSpreadsheet, rowsToCSV } from "@/lib/cards/spreadsheet";

const UploadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  setId: z.string().min(1),
  cardId: z.string().optional(),
});

/**
 * Widen MIME allowlist to cover images, audio, video, spreadsheets, PDFs, and common files.
 */
const ALLOWED_MIMES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // Audio
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
  'audio/x-m4a',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  // Spreadsheets
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  // PDF
  'application/pdf',
  // General documents
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

// Size caps per kind (in MB)
const SIZE_CAPS: Record<string, number> = {
  image: 10,
  audio: 25,
  video: 25,
  spreadsheet: 10,
  pdf: 10,
  file: 10,
};

// Inline cap for Gemini multimodal (Task 4)
const INLINE_SIZE_CAP = 4 * 1024 * 1024; // 4 MB

export async function uploadCardAsset(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const file = formData.get("file") as File;
  const rawSetId = formData.get("setId") as string | null;
  const cardId = formData.get("cardId") as string | null;

  if (!file) throw new Error("No file uploaded");

  // Resolve the setId. On the "create new set" flow the client sends "new"
  // (a placeholder) because the set does not exist yet. In that case we store
  // the asset with a null setId and backfill it when the set is saved.
  // If a real setId is provided, verify it exists and the user owns it.
  let resolvedSetId: string | null = null;
  if (rawSetId && rawSetId !== "new") {
    const set = await prisma.set.findUnique({
      where: { id: rawSetId },
      select: { userId: true },
    });
    if (!set) {
      // Set doesn't exist yet (unsaved) — store without a set link.
      resolvedSetId = null;
    } else if (set.userId !== session.user.id) {
      throw new Error("You do not have access to this set");
    } else {
      resolvedSetId = rawSetId;
    }
  }

  // Validate MIME type against allowlist
  if (!ALLOWED_MIMES.includes(file.type)) {
    throw new Error(`File type "${file.type}" not allowed`);
  }

  // Sniff the kind from MIME + filename
  const kind = sniffAssetKind(file.type, file.name);

  // Validate size per kind
  const capMB = SIZE_CAPS[kind] || 10;
  const capBytes = capMB * 1024 * 1024;
  if (file.size > capBytes) {
    throw new Error(`File exceeds ${capMB}MB limit for ${kind} files`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const blob = await uploadAsset(file.name, file.type, buffer);

  // Extract preview text for spreadsheets
  let textExtract: string | null = null;
  if (kind === "spreadsheet") {
    try {
      const parsed = parseSpreadsheet(buffer, file.type);
      textExtract = rowsToCSV(parsed.rows, 10); // Store first 10 rows as CSV
    } catch (e) {
      console.error("Failed to parse spreadsheet preview:", e);
      // Graceful degradation: missing preview is okay
    }
  }

  const asset = await prisma.cardAsset.create({
    data: {
      userId: session.user.id,
      setId: resolvedSetId,
      cardId: cardId || null,
      storageKey: blob.url,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      kind,
      textExtract,
    },
  });

  return { assetId: asset.id, url: blob.url, kind, inlineable: file.size <= INLINE_SIZE_CAP };
}
