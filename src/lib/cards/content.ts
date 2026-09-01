import { z } from "zod";
import { createHash } from "crypto";

export const INLINE_MARK_KEYS = ["bold", "italic", "underline", "highlight"] as const;
export type InlineMarkKey = typeof INLINE_MARK_KEYS[number];

export const InlineTextMarkSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  highlight: z.boolean().optional(),
}).refine((mark) => mark.end > mark.start, {
  message: "Text mark end must be after its start",
});

export type InlineTextMark = z.infer<typeof InlineTextMarkSchema>;
export type InlineTextStyle = Partial<Record<InlineMarkKey, true>>;

export const ContentBlockSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["text", "image", "video", "file"]),
  text: z.string().optional(),
  assetId: z.string().optional(),
  position: z.number().int(),
  side: z.enum(["term", "definition"]).optional(),
  // Formatting stays structured rather than HTML so every renderer remains
  // XSS-safe and can follow the active light/dark theme.
  listType: z.enum(["bullet", "numbered"]).nullable().optional(),
  indent: z.number().int().min(0).max(6).nullable().optional(),
  marks: z.array(InlineTextMarkSchema).nullable().optional(),
});

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function hasStyle(style: InlineTextStyle) {
  return INLINE_MARK_KEYS.some((key) => style[key] === true);
}

function sameStyle(a: InlineTextStyle, b: InlineTextStyle) {
  return INLINE_MARK_KEYS.every((key) => a[key] === b[key]);
}

function styleForRange(marks: InlineTextMark[], start: number, end: number): InlineTextStyle {
  const style: InlineTextStyle = {};

  for (const mark of marks) {
    if (mark.start > start || mark.end < end) continue;
    for (const key of INLINE_MARK_KEYS) {
      if (mark[key] === true) style[key] = true;
    }
  }

  return style;
}

function mergeTextMarks(marks: InlineTextMark[]): InlineTextMark[] {
  const merged: InlineTextMark[] = [];

  for (const mark of [...marks].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged[merged.length - 1];
    const previousStyle = previous ? styleForRange([previous], previous.start, previous.end) : {};
    const currentStyle = styleForRange([mark], mark.start, mark.end);

    if (previous && previous.end === mark.start && sameStyle(previousStyle, currentStyle)) {
      previous.end = mark.end;
    } else if (hasStyle(currentStyle)) {
      merged.push({ ...mark });
    }
  }

  return merged;
}

/**
 * Normalize marks coming from a client or JSON column before rendering or
 * persisting them. Invalid ranges are discarded and valid ranges are clipped
 * to the current text, so formatting can never escape its text block.
 */
export function normalizeTextMarks(value: unknown, textLength: number): InlineTextMark[] {
  const length = Math.max(0, Math.floor(textLength));
  if (length === 0 || !Array.isArray(value)) return [];

  const normalized: InlineTextMark[] = [];
  for (const raw of value) {
    const parsed = InlineTextMarkSchema.safeParse(raw);
    if (!parsed.success) continue;

    const start = clamp(parsed.data.start, 0, length);
    const end = clamp(parsed.data.end, 0, length);
    if (end <= start) continue;

    const style: InlineTextStyle = {};
    for (const key of INLINE_MARK_KEYS) {
      if (parsed.data[key] === true) style[key] = true;
    }
    if (hasStyle(style)) normalized.push({ start, end, ...style });
  }

  return mergeTextMarks(normalized);
}

/** Toggle one inline style across a selected text range. */
export function toggleTextMark(
  marks: unknown,
  start: number,
  end: number,
  key: InlineMarkKey,
  textLength: number,
): InlineTextMark[] {
  const normalized = normalizeTextMarks(marks, textLength);
  const from = clamp(Math.min(start, end), 0, Math.max(0, textLength));
  const to = clamp(Math.max(start, end), 0, Math.max(0, textLength));
  if (from >= to) return normalized;

  const boundaries = new Set([0, textLength, from, to]);
  for (const mark of normalized) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  const intervals = ordered.slice(0, -1).map((value, index) => ({
    start: value,
    end: ordered[index + 1],
  }));
  const selectedIntervals = intervals.filter((interval) => interval.start >= from && interval.end <= to);
  const shouldAdd = selectedIntervals.some(
    (interval) => styleForRange(normalized, interval.start, interval.end)[key] !== true,
  );

  const next: InlineTextMark[] = [];
  for (const interval of intervals) {
    const style = styleForRange(normalized, interval.start, interval.end);
    if (interval.start >= from && interval.end <= to) {
      if (shouldAdd) style[key] = true;
      else delete style[key];
    }
    if (hasStyle(style)) next.push({ start: interval.start, end: interval.end, ...style });
  }

  return mergeTextMarks(next);
}

/** Whether every character in the selected range already has a style. */
export function isTextMarkActive(
  marks: unknown,
  start: number,
  end: number,
  key: InlineMarkKey,
  textLength: number,
) {
  const normalized = normalizeTextMarks(marks, textLength);
  const from = clamp(Math.min(start, end), 0, Math.max(0, textLength));
  const to = clamp(Math.max(start, end), 0, Math.max(0, textLength));
  if (from >= to) return false;

  const boundaries = new Set([from, to]);
  for (const mark of normalized) {
    if (mark.end > from && mark.start < to) {
      boundaries.add(clamp(mark.start, from, to));
      boundaries.add(clamp(mark.end, from, to));
    }
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  return ordered.slice(0, -1).every((value, index) => {
    const segmentEnd = ordered[index + 1];
    return styleForRange(normalized, value, segmentEnd)[key] === true;
  });
}

/**
 * Keep existing inline formatting attached to text when a user types or
 * deletes inside a formatted range. Formatting on untouched text shifts with
 * the edit; a replacement inside a formatted range inherits that formatting.
 */
export function remapTextMarksForTextChange(
  marks: unknown,
  previousText: string,
  nextText: string,
): InlineTextMark[] {
  if (previousText === nextText) return normalizeTextMarks(marks, nextText.length);

  let prefix = 0;
  while (
    prefix < previousText.length &&
    prefix < nextText.length &&
    previousText[prefix] === nextText[prefix]
  ) {
    prefix += 1;
  }

  let oldEnd = previousText.length;
  let newEnd = nextText.length;
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    previousText[oldEnd - 1] === nextText[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const delta = (newEnd - prefix) - (oldEnd - prefix);
  const normalized = normalizeTextMarks(marks, previousText.length);
  const remapped: InlineTextMark[] = [];

  for (const mark of normalized) {
    if (mark.end < prefix || (mark.end === prefix && oldEnd !== prefix)) {
      remapped.push({ ...mark });
      continue;
    }

    // Typing at the end of a formatted run keeps the new characters styled.
    if (oldEnd === prefix && mark.end === prefix) {
      remapped.push({ ...mark, end: mark.end + delta });
      continue;
    }

    if (mark.start >= oldEnd) {
      remapped.push({ ...mark, start: mark.start + delta, end: mark.end + delta });
      continue;
    }

    const start = mark.start < prefix ? mark.start : prefix;
    const end = mark.end > oldEnd ? mark.end + delta : newEnd;
    if (end > start) remapped.push({ ...mark, start, end });
  }

  return normalizeTextMarks(remapped, nextText.length);
}

export interface TextMarkSegment {
  text: string;
  marks: InlineTextStyle;
}

/** Split text into safe, renderable runs of equivalent inline formatting. */
export function getTextMarkSegments(text: string, marks: unknown): TextMarkSegment[] {
  if (text.length === 0) return [{ text: "", marks: {} }];

  const normalized = normalizeTextMarks(marks, text.length);
  if (normalized.length === 0) return [{ text, marks: {} }];

  const boundaries = new Set([0, text.length]);
  for (const mark of normalized) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1];
    return { text: text.slice(start, end), marks: styleForRange(normalized, start, end) };
  });
}

/**
 * Numbered lists are stored as block metadata, so their display number needs
 * to be derived from sibling text blocks rather than the mixed-media position.
 * A non-numbered block starts a new ordered-list run, which keeps a later list
 * from inheriting the count of an earlier, unrelated list.
 */
export function getNumberedListIndex(blocks: ContentBlock[], index: number): number {
  let count = 0;

  for (let position = index - 1; position >= 0; position -= 1) {
    const block = blocks[position];
    if (block.type !== "text" || block.listType !== "numbered") break;
    count += 1;
  }

  return count;
}

/**
 * Compute a content hash for a list of blocks.
 * Used for cache invalidation: when block content changes, the hash changes.
 * @param blocks Content blocks to hash
 * @returns SHA-256 hex digest
 */
export function computeContentHash(blocks: ContentBlock[]): string {
  const data = blocks
    .map((b) => `${b.type}:${b.position}:${b.text || ""}:${b.assetId || ""}:${b.listType || ""}:${b.indent ?? 0}`)
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
