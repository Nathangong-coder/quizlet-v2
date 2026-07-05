import { z } from "zod";
import { createHash } from "crypto";

export const ContentBlockSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["text", "image", "video", "file"]),
  text: z.string().optional(),
  assetId: z.string().optional(),
  position: z.number().int(),
  side: z.enum(["term", "definition"]).optional(),
});

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/**
 * Compute a content hash for a list of blocks.
 * Used for cache invalidation: when block content changes, the hash changes.
 * @param blocks Content blocks to hash
 * @returns SHA-256 hex digest
 */
export function computeContentHash(blocks: ContentBlock[]): string {
  const data = blocks
    .map((b) => `${b.type}:${b.position}:${b.text || ""}:${b.assetId || ""}`)
    .join("|");
  return createHash("sha256").update(data).digest("hex");
}

export function legacyCardToContentBlocks(term: string, definition: string) {
  return {
    term: [
      { type: "text" as const, text: term, position: 0 },
    ],
    definition: [
      { type: "text" as const, text: definition, position: 0 },
    ],
  };
}

/**
 * Convert content blocks to plain text, including fallback labels for non-text blocks.
 * Used for: matching tiles, print, AI when media can't be sent inline, search fallback.
 */
export function contentBlocksToPlainText(blocks: ContentBlock[]) {
  return blocks
    .map((b) => {
      if (b.type === "text") return b.text || "";
      // Fallback labels for media: [image: filename], [audio: filename], etc.
      const label = {
        image: "image",
        audio: "audio",
        video: "video",
        file: "file",
      }[b.type] || b.type;
      return `[${label}]`;
    })
    .filter((text) => text.length > 0)
    .join("\n");
}
