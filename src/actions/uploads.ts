"use server";

import { uploadAsset } from "@/lib/uploads";
import { prisma } from "@/lib/db";
import { auth } from '@/auth';
import { z } from "zod";

const UploadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  setId: z.string().min(1),
  cardId: z.string().optional(),
});

export async function uploadCardAsset(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const file = formData.get("file") as File;
  const setId = formData.get("setId") as string;
  const cardId = formData.get("cardId") as string | null;

  if (!file) throw new Error("No file uploaded");

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4", "application/pdf"];
  if (!allowedTypes.includes(file.type)) throw new Error("File type not allowed");

  // Validate size (e.g., 10MB limit)
  if (file.size > 10 * 1024 * 1024) throw new Error("File too large");

  const blob = await uploadAsset(file.name, file.type, Buffer.from(await file.arrayBuffer()));

  const asset = await prisma.cardAsset.create({
    data: {
      userId: session.user.id,
      setId,
      cardId: cardId || null,
      storageKey: blob.url,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  });

  return { assetId: asset.id, url: blob.url };
}
