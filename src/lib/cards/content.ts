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

export function contentBlocksToPlainText(blocks: ContentBlock[]) {
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
