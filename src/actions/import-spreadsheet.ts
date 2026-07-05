'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parseSpreadsheet, looksLikeCardTable } from '@/lib/cards/spreadsheet';
import { z } from 'zod';

const ImportSpreadsheetSchema = z.object({
  setId: z.string().min(1),
  termColIndex: z.number().int().min(0),
  defColIndex: z.number().int().min(0),
  skipHeaderRow: z.boolean(),
  file: z.instanceof(File),
});

export async function importSpreadsheet(
  setId: string,
  file: File,
  termColIndex: number = 0,
  defColIndex: number = 1,
  skipHeaderRow: boolean = false,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  // Verify set ownership
  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: { userId: true, cards: { select: { position: true } } },
  });

  if (!set || set.userId !== session.user.id) {
    throw new Error('Set not found or access denied');
  }

  try {
    // Parse spreadsheet
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseSpreadsheet(buffer, file.type);

    let rows = parsed.rows;
    if (skipHeaderRow && rows.length > 0) {
      rows = rows.slice(1);
    }

    if (rows.length === 0) {
      return { success: false, error: 'No data rows found in spreadsheet', imported: 0 };
    }

    // Get next position
    const maxPosition = set.cards.length > 0 ? Math.max(...set.cards.map(c => c.position)) : 0;

    // Create cards from rows
    const created = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const term = (row[termColIndex] || '').trim();
      const definition = (row[defColIndex] || '').trim();

      if (!term || !definition) continue; // Skip incomplete rows

      const card = await prisma.card.create({
        data: {
          setId,
          term,
          definition,
          position: maxPosition + i + 1,
        },
      });
      created.push(card);
    }

    return { success: true, imported: created.length, cards: created };
  } catch (error: any) {
    console.error('Spreadsheet import error:', error);
    throw new Error(`Import failed: ${error.message}`);
  }
}
