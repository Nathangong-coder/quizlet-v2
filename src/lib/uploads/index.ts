import { put, del } from "@vercel/blob";

export async function uploadAsset(
  filename: string,
  contentType: string,
  body: Blob | Buffer | string,
) {
  const blob = await put(filename, body, {
    contentType,
    access: "private",
  });
  return blob;
}

export async function deleteAsset(url: string) {
  await del(url);
}
