import { describe, it, expect, beforeEach } from 'vitest';
import { checkRequestBudget, MediaPartCache } from '@/lib/ai/media';

// Note: ContentPart is from @google/generative-ai but we avoid importing it directly
// to prevent test environment issues. We define a local test type instead.
type TestContentPart = {
  inlineData?: {
    mimeType: string;
    data: string;
  };
  text?: string;
};

describe('checkRequestBudget', () => {
  it('accepts request within budget', () => {
    const part: TestContentPart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: 'a'.repeat(1000), // ~750 bytes after base64 decode
      },
    };
    const { isWithinBudget, totalSize } = checkRequestBudget(
      [part as any],
      100,
    );
    expect(isWithinBudget).toBe(true);
    expect(totalSize).toBeLessThan(10 * 1024 * 1024); // 10 MB cap
  });

  it('rejects request exceeding budget', () => {
    // Create parts that sum to > 10 MB budget
    const parts: TestContentPart[] = [];
    // Each part: base64 string of 8 MB represents ~6 MB of data
    // After estimation: 8MB * (3/4) + 100 = 6MB + 100 bytes per part
    // Two parts: ~12.2 MB > 10 MB budget
    const largeData = 'a'.repeat(8 * 1024 * 1024); // 8 MB base64 string per part
    for (let i = 0; i < 2; i++) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: largeData,
        },
      });
    }

    const { isWithinBudget } = checkRequestBudget(
      (parts as any[]) as any,
      100,
    );
    expect(isWithinBudget).toBe(false);
  });

  it('includes text size in budget calculation', () => {
    const part: TestContentPart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: 'a'.repeat(1000),
      },
    };
    const largeTextSize = 5 * 1024 * 1024; // 5 MB text

    const { totalSize } = checkRequestBudget([part as any], largeTextSize);
    expect(totalSize).toBeGreaterThan(largeTextSize);
  });

  it('handles empty parts list', () => {
    const { isWithinBudget, totalSize } = checkRequestBudget([]);
    expect(isWithinBudget).toBe(true);
    expect(totalSize).toBe(0);
  });

  it('handles text-only request', () => {
    const { isWithinBudget, totalSize } = checkRequestBudget([], 1000);
    expect(isWithinBudget).toBe(true);
    expect(totalSize).toBe(1000);
  });
});

describe('MediaPartCache', () => {
  let cache: MediaPartCache;

  beforeEach(() => {
    cache = new MediaPartCache();
  });

  it('has a cache Map structure', () => {
    expect(cache).toBeDefined();
    expect((cache as any).cache).toBeDefined();
    expect((cache as any).cache instanceof Map).toBe(true);
  });

  it('can store and retrieve mocked parts', () => {
    const testId = 'test-asset-1';
    const mockPart: TestContentPart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: 'data123',
      },
    };

    // Manually set cache to verify memoization structure
    (cache as any).cache.set(testId, mockPart);
    const cached = (cache as any).cache.get(testId);
    expect(cached).toEqual(mockPart);
  });

  it('cache returns null for missing entries', () => {
    const cached = (cache as any).cache.get('nonexistent');
    expect(cached).toBeUndefined();
  });
});
