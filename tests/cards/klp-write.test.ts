import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  aggregate: vi.fn(),
  updateMany: vi.fn(),
  createMany: vi.fn(),
  findMany: vi.fn(),
  cardUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => {
      h.transaction();
      return fn({
        cardKlp: {
          aggregate: h.aggregate,
          updateMany: h.updateMany,
          createMany: h.createMany,
          findMany: h.findMany,
        },
        card: { update: h.cardUpdate },
      });
    },
  },
}));

import { writeKlpVersion } from '@/lib/cards/klp-write';

beforeEach(() => {
  vi.clearAllMocks();
  h.aggregate.mockResolvedValue({ _max: { version: 2 } });
  h.findMany.mockResolvedValue([{ id: 'k-a' }, { id: 'k-b' }]);
});

const rows = [
  { text: 'a', weight: 3, kind: 'mechanism', source: 'ai', promptVersion: 2 },
  { text: 'b', weight: 1, kind: 'definition', source: 'ai', promptVersion: 2 },
];

describe('writeKlpVersion', () => {
  it('supersedes the live rows and writes the next version', async () => {
    await writeKlpVersion('c1', rows, 'hash');
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { cardId: 'c1', supersededAt: null },
      data: { supersededAt: expect.any(Date) },
    });
    expect(h.createMany.mock.calls[0][0].data[0]).toMatchObject({ cardId: 'c1', version: 3, index: 0 });
  });

  /** Relations attach to real rows, so the ids must come back. */
  it('returns the created ids in index order', async () => {
    const out = await writeKlpVersion('c1', rows, 'hash');
    expect(out).toEqual({ version: 3, klpIds: ['k-a', 'k-b'] });
    expect(h.findMany).toHaveBeenCalledWith({
      where: { cardId: 'c1', version: 3 },
      orderBy: { index: 'asc' },
      select: { id: true },
    });
  });

  /**
   * A new KLP version has NEW ids, so its topics do not exist yet. Leaving
   * kltStatus 'ready' would serve the previous version's topics against
   * propositions the card no longer teaches.
   */
  it('resets kltStatus to pending', async () => {
    await writeKlpVersion('c1', rows, 'hash');
    expect(h.cardUpdate.mock.calls[0][0].data).toMatchObject({
      klpStatus: 'ready',
      klpVersion: 3,
      klpSourceHash: 'hash',
      kltStatus: 'pending',
    });
  });

  it('reads the version inside the transaction, not before it', async () => {
    await writeKlpVersion('c1', rows, 'hash');
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.aggregate).toHaveBeenCalledTimes(1);
  });
});
