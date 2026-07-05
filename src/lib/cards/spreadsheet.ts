import { read, utils } from 'xlsx';
import { z } from 'zod';

export interface ParsedSpreadsheet {
  rows: string[][];
  sheetName: string;
}

export interface CardTableDetection {
  isTermDef: boolean;
  termCol: number;
  defCol: number;
}

/**
 * Parse a spreadsheet file (XLSX or CSV) into a 2D array of strings.
 * @param buffer File buffer (arraybuffer or Buffer)
 * @param mimeType MIME type (e.g., 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' for xlsx, 'text/csv' for csv)
 */
export function parseSpreadsheet(buffer: Buffer | ArrayBuffer, mimeType: string): ParsedSpreadsheet {
  const arrayBuffer = buffer instanceof Buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
  const workbook = read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('No sheets found in spreadsheet');

  const worksheet = workbook.Sheets[sheetName];
  const rawRows = utils.sheet_to_json<any[]>(worksheet, { header: 1 }) as any[][];

  const rows = rawRows.filter(
    (row) => Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && cell !== ''),
  );

  return {
    rows: rows.map((row) =>
      (Array.isArray(row) ? row : [row]).map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim())),
    ),
    sheetName,
  };
}

/**
 * Detect if a 2D array looks like a term/definition card table.
 * Heuristic: ≥ 2 columns, ≥ 2 rows (after potential header), first two columns mostly non-empty.
 * Ignores header row if it matches known header patterns.
 */
export function looksLikeCardTable(rows: string[][]): CardTableDetection {
  if (rows.length < 2 || rows[0].length < 2) {
    return { isTermDef: false, termCol: 0, defCol: 1 };
  }

  // Check if first row is a header (common patterns: "term", "word", "front", "question", etc.)
  const headerPatterns = [
    /^(term|word|front|question|q|key|concept|title)$/i,
    /^(definition|meaning|back|answer|a|value|content|description)$/i,
  ];
  let startRow = 0;
  const firstRowIsHeader = headerPatterns.some(
    (pattern) => pattern.test(rows[0][0]) || pattern.test(rows[0][1]),
  );
  if (firstRowIsHeader) {
    startRow = 1;
  }

  // Need at least 2 content rows
  if (rows.length - startRow < 2) {
    return { isTermDef: false, termCol: 0, defCol: 1 };
  }

  // Check that the first two columns are mostly non-empty across content rows
  let termColNonEmpty = 0;
  let defColNonEmpty = 0;
  for (let i = startRow; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].length > 0) termColNonEmpty++;
    if (rows[i][1] && rows[i][1].length > 0) defColNonEmpty++;
  }

  const contentRows = rows.length - startRow;
  const threshold = 0.7; // 70% of rows must have both columns populated
  if (termColNonEmpty >= contentRows * threshold && defColNonEmpty >= contentRows * threshold) {
    return { isTermDef: true, termCol: 0, defCol: 1 };
  }

  return { isTermDef: false, termCol: 0, defCol: 1 };
}

/**
 * Convert a 2D array to CSV string (for textExtract preview).
 */
export function rowsToCSV(rows: string[][], maxRows = 10): string {
  return rows
    .slice(0, maxRows)
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

/**
 * Sniff the kind of an asset based on MIME type and filename.
 */
export function sniffAssetKind(
  mimeType: string,
  originalName: string,
): 'image' | 'audio' | 'video' | 'spreadsheet' | 'pdf' | 'file' {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = originalName.toLowerCase();

  // Image
  if (lowerMime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(lowerName)) {
    return 'image';
  }

  // Video (check before audio since .webm can be both)
  if (
    lowerMime.startsWith('video/') ||
    /\.(mp4|mkv|mov|quicktime)$/i.test(lowerName)
  ) {
    return 'video';
  }

  // Audio
  if (
    lowerMime.startsWith('audio/') ||
    /\.(mp3|wav|m4a|ogg|webm|flac)$/i.test(lowerName)
  ) {
    return 'audio';
  }

  // Spreadsheet
  if (
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('excel') ||
    lowerMime === 'text/csv' ||
    /\.(xlsx?|csv)$/i.test(lowerName)
  ) {
    return 'spreadsheet';
  }

  // PDF
  if (lowerMime.includes('pdf') || /\.pdf$/i.test(lowerName)) {
    return 'pdf';
  }

  return 'file';
}
