import { put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import path from "path";

export async function uploadAsset(
  filename: string,
  contentType: string,
  body: Blob | Buffer | string,
) {
  // Generate unique filename to avoid collisions
  // Format: {uuid}_{original-filename}
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  const uniqueFilename = `${randomUUID()}_${nameWithoutExt}${ext}`;

  const blob = await put(uniqueFilename, body, {
    contentType,
    access: "private",
  });
  return blob;
}

export async function deleteAsset(url: string) {
  await del(url);
}
