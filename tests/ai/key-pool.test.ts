// tests/ai/key-pool.test.ts
import { describe, it, expect } from 'vitest';
import { selectAttemptOrder, type PoolCredential } from '@/lib/ai/key-pool';

const at = (min: number) => new Date(Date.UTC(2026, 6, 27, 12, min));

function cred(over: Partial<PoolCredential> & { id: string }): PoolCredential {
  return { role: 'primary', enabled: true, lastUsedAt: null, ...over };
}

describe('selectAttemptOrder', () => {
  it('orders enabled primaries least-recently-used first', () => {
    const order = selectAttemptOrder([
      cred({ id: 'recent', lastUsedAt: at(30) }),
      cred({ id: 'stale', lastUsedAt: at(5) }),
      cred({ id: 'middle', lastUsedAt: at(15) }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['stale', 'middle', 'recent']);
  });

  it('puts never-used keys before ever-used ones', () => {
    const order = selectAttemptOrder([
      cred({ id: 'used', lastUsedAt: at(1) }),
      cred({ id: 'fresh', lastUsedAt: null }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['fresh', 'used']);
  });

  it('places every backup after every primary regardless of recency', () => {
    const order = selectAttemptOrder([
      cred({ id: 'backup-stale', role: 'backup', lastUsedAt: at(1) }),
      cred({ id: 'primary-recent', role: 'primary', lastUsedAt: at(59) }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['primary-recent', 'backup-stale']);
  });

  it('excludes disabled credentials entirely', () => {
    const order = selectAttemptOrder([
      cred({ id: 'off', enabled: false }),
      cred({ id: 'on' }),
    ]);
    expect(order.map((c) => c.id)).toEqual(['on']);
  });

  it('is deterministic when timestamps tie, falling back to id', () => {
    const input = [
      cred({ id: 'b', lastUsedAt: at(10) }),
      cred({ id: 'a', lastUsedAt: at(10) }),
    ];
    expect(selectAttemptOrder(input).map((c) => c.id)).toEqual(['a', 'b']);
    expect(selectAttemptOrder([...input].reverse()).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const input = [cred({ id: 'b', lastUsedAt: at(20) }), cred({ id: 'a', lastUsedAt: at(1) })];
    const snapshot = input.map((c) => c.id);
    selectAttemptOrder(input);
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });

  it('returns an empty list when nothing is usable', () => {
    expect(selectAttemptOrder([])).toEqual([]);
    expect(selectAttemptOrder([cred({ id: 'off', enabled: false })])).toEqual([]);
  });

  it('alternates keys across successive calls as each is stamped used', () => {
    // Simulates the "run both together" behaviour: after A serves a request
    // and gets stamped, B becomes least-recently-used and serves the next.
    let a = cred({ id: 'A', lastUsedAt: at(0) });
    let b = cred({ id: 'B', lastUsedAt: at(1) });
    const picked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const first = selectAttemptOrder([a, b])[0];
      picked.push(first.id);
      const stamped = { ...first, lastUsedAt: at(10 + i) };
      if (stamped.id === 'A') a = stamped; else b = stamped;
    }
    expect(picked).toEqual(['A', 'B', 'A', 'B']);
  });
});
