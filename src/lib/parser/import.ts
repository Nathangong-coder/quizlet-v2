import { z } from 'zod';

export interface ParseOptions {
  cardDelimiter?: string;
  fieldDelimiter?: string;
}

export const ParsedCardSchema = z.object({
  term: z.string().min(1, { message: 'Term cannot be empty' }).trim(),
  definition: z.string().min(1, { message: 'Definition cannot be empty' }).trim(),
});

export type ParsedCard = z.infer<typeof ParsedCardSchema>;

/**
 * Splits a string by a delimiter, respecting quoted values.
 */
function splitRespectingQuotes(text: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      // We keep the quotes for now to handle them in the final trim/cleanup
      // or we can strip them here. The requirement says "Net income..." -> "Net income..."
      // Usually, quoted values in CSVs have the quotes stripped.
      current += char;
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Removes surrounding quotes from a string if they exist.
 */
function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

export function parseImport(text: string, options?: ParseOptions): ParsedCard[] {
  if (!text || text.trim() === '') {
    return [];
  }

  const cardDelimiter = options?.cardDelimiter ?? ';';
  const fieldDelimiter = options?.fieldDelimiter ?? ',';

  // Split into individual card entries
  const entries = splitRespectingQuotes(text, cardDelimiter);
  const cards: ParsedCard[] = [];

  for (const entry of entries) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) continue;

    // Split entry into term and definition
    const fields = splitRespectingQuotes(trimmedEntry, fieldDelimiter);

    if (fields.length < 2) {
      throw new Error(`Missing field delimiter "${fieldDelimiter}" in entry: "${trimmedEntry}"`);
    }

    // We only care about the first two fields as per the ParsedCard schema
    const term = unquote(fields[0]);
    const definition = unquote(fields[1]);

    const validated = ParsedCardSchema.parse({
      term,
      definition,
    });

    cards.push(validated);
  }

  return cards;
}
