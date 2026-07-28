/**
 * Converts the Gemini-shaped parts that src/lib/ai/media.ts already produces
 * into AI SDK message content. media.ts is deliberately left unchanged.
 */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type SdkContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: string; mediaType: string };

export function toSdkContent(parts: GeminiPart[]): SdkContentPart[] {
  return parts.map((part) =>
    'text' in part
      ? { type: 'text' as const, text: part.text }
      : { type: 'file' as const, data: part.inlineData.data, mediaType: part.inlineData.mimeType },
  );
}
