import { z } from "zod";

export const ContentBlockSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["text", "image", "video", "file"]),
  text: z.string().optional(),
  assetId: z.string().optional(),
  position: z.number().int(),
});

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

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
