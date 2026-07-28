import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

/**
 * Coverage for the database-backed half of src/lib/ai/generate.ts —
 * `resolveCandidates`, `resolveTaskModel`, and `generateJson`.
 *
 * generate.test.ts only exercises `runAttempts` with an injected executor,
 * which is why a real bug lived here undetected: a task's model override was
 * applied to EVERY credential in the pool, not just the pinned one. `prisma` is
 * already dynamically imported inside these functions, so a module mock is all
 * it takes to reach them.
 */

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  generateText: vi.fn(),
  resolveLanguageModel: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    aiCredential: { findMany: h.findMany, update: h.update, updateMany: h.updateMany },
    aiTaskRouting: { findUnique: h.findUnique },
  },
}));

vi.mock('ai', () => ({
  generateText: h.generateText,
  Output: { object: (opts: unknown) => opts },
}));

vi.mock('@/lib/security/api-key', () => ({
  decryptApiKey: (value: string) => `decrypted:${value}`,
}));

vi.mock('@/lib/ai/providers', () => ({
  AI_PROVIDERS: ['google', 'anthropic', 'openai', 'openrouter', 'custom'],
  resolveLanguageModel: h.resolveLanguageModel,
}));

import { generateJson, resolveTaskModel, AiGenerationError } from '@/lib/ai/generate';

const Schema = z.object({ ok: z.boolean() });

interface CredOverrides {
  id?: string;
  provider?: string;
  label?: string;
  defaultModel?: string;
  role?: string;
  enabled?: boolean;
  lastUsedAt?: Date | null;
}

function cred(over: CredOverrides = {}) {
  return {
    id: 'google-1',
    userId: 'u1',
    provider: 'google',
    label: 'Google',
    encryptedApiKey: 'enc',
    keyHint: 'AIza…abcd',
    baseUrl: null,
    defaultModel: 'gemini-3.6-flash',
    role: 'primary',
    enabled: true,
    lastUsedAt: null,
    lastErrorAt: null,
    lastErrorKind: null,
    verifiedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

const GOOGLE = cred();
const ANTHROPIC = cred({
  id: 'anthropic-1',
  provider: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-sonnet-4-5',
  role: 'backup',
});

function setup(credentials: ReturnType<typeof cred>[], routing: { credentialId: string | null; model: string | null } | null) {
  h.findMany.mockResolvedValue(credentials);
  h.findUnique.mockResolvedValue(routing ? { userId: 'u1', task: 'grade', ...routing } : null);
}

/** The `model` each attempt was actually resolved with, in attempt order. */
function attemptedModels(): string[] {
  return h.resolveLanguageModel.mock.calls.map((call) => (call[0] as { model: string }).model);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.update.mockResolvedValue({});
  h.updateMany.mockResolvedValue({ count: 1 });
  h.resolveLanguageModel.mockImplementation((args: unknown) => args);
  h.generateText.mockResolvedValue({ output: { ok: true } });
});

describe('resolveTaskModel / resolveCandidates', () => {
  it('narrows the pool to the pinned credential', async () => {
    setup([GOOGLE, ANTHROPIC], { credentialId: ANTHROPIC.id, model: null });
    // Without the pin, the primary (Google) would lead the order.
    expect(await resolveTaskModel('u1', 'grade')).toBe('claude-sonnet-4-5');
  });

  it('prefers routing.model over the credential default for a pinned credential', async () => {
    setup([GOOGLE, ANTHROPIC], { credentialId: GOOGLE.id, model: 'gemini-3-pro' });
    expect(await resolveTaskModel('u1', 'grade')).toBe('gemini-3-pro');
  });

  it('falls back to the credential default when the pin carries no model', async () => {
    setup([GOOGLE, ANTHROPIC], { credentialId: GOOGLE.id, model: null });
    expect(await resolveTaskModel('u1', 'grade')).toBe('gemini-3.6-flash');
  });

  it('IGNORES a model override when no credential is pinned', async () => {
    // Regression guard. `{ credentialId: null, model: 'gemini-3-pro' }` is a
    // state the settings panel used to allow, and the old code applied the
    // override to every candidate — including the Anthropic key, which 404s on
    // a Gemini model id and gets badged broken for it.
    setup([GOOGLE, ANTHROPIC], { credentialId: null, model: 'gemini-3-pro' });
    expect(await resolveTaskModel('u1', 'grade')).toBe('gemini-3.6-flash');
  });

  it('returns null when nothing is attemptable', async () => {
    setup([], null);
    expect(await resolveTaskModel('u1', 'grade')).toBeNull();
  });
});

describe('generateJson', () => {
  const call = () =>
    generateJson({ userId: 'u1', task: 'grade', schema: Schema, prompt: 'hi' });

  it('attempts every candidate with its OWN default model when no credential is pinned', async () => {
    setup([GOOGLE, ANTHROPIC], { credentialId: null, model: 'gemini-3-pro' });
    h.generateText
      .mockRejectedValueOnce(new Error('[503 Service Unavailable] overloaded'))
      .mockResolvedValueOnce({ output: { ok: true } });

    await expect(call()).resolves.toEqual({ ok: true });
    expect(attemptedModels()).toEqual(['gemini-3.6-flash', 'claude-sonnet-4-5']);
    expect(attemptedModels()).not.toContain('gemini-3-pro');
  });

  it('applies the model override when the task IS pinned to a credential', async () => {
    setup([GOOGLE, ANTHROPIC], { credentialId: GOOGLE.id, model: 'gemini-3-pro' });
    await expect(call()).resolves.toEqual({ ok: true });
    expect(attemptedModels()).toEqual(['gemini-3-pro']);
  });

  it('stamps lastUsedAt before each attempt, including ones that fail', async () => {
    // "Least recently TRIED": a concurrent burst all reads lastUsedAt before
    // any attempt finishes, so stamping only on success sends every request to
    // the same key.
    setup([GOOGLE, ANTHROPIC], null);
    h.generateText
      .mockRejectedValueOnce(new Error('[429 Too Many Requests] rate limit exceeded'))
      .mockResolvedValueOnce({ output: { ok: true } });

    await expect(call()).resolves.toEqual({ ok: true });
    const stamped = h.update.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id);
    expect(stamped).toEqual([GOOGLE.id, ANTHROPIC.id]);
    for (const c of h.update.mock.calls) {
      expect((c[0] as { data: { lastUsedAt: Date } }).data.lastUsedAt).toBeInstanceOf(Date);
    }
  });

  it('flags only user-attributed, non-retryable failures onto their credential', async () => {
    setup([GOOGLE, ANTHROPIC], null);
    h.generateText
      .mockRejectedValueOnce(new Error('[401] API key not valid'))
      .mockResolvedValueOnce({ output: { ok: true } });

    await call();
    const flagged = h.updateMany.mock.calls.map((c) => c[0] as { where: { id: string }; data: { lastErrorKind: string } });
    expect(flagged).toHaveLength(1);
    expect(flagged[0].where.id).toBe(GOOGLE.id);
    expect(flagged[0].data.lastErrorKind).toBe('invalid_key');
  });

  it('explains a pinned-but-disabled credential instead of claiming no keys exist', async () => {
    setup([GOOGLE, cred({ id: 'disabled-1', label: 'Backup key', enabled: false })], {
      credentialId: 'disabled-1',
      model: null,
    });

    const err = await call().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AiGenerationError);
    const detail = (err as AiGenerationError).detail;
    expect(detail.title).not.toBe('No AI provider configured');
    expect(detail.why).toContain('Backup key');
    expect(detail.why).toContain('turned off');
    expect(detail.fix?.href).toBe('/settings/ai');
    expect(detail.attribution).toBe('user');
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it('explains an all-disabled pool instead of claiming no keys exist', async () => {
    setup([cred({ enabled: false }), cred({ id: 'anthropic-1', enabled: false })], null);

    const err = await call().then(() => null, (e) => e);
    const detail = (err as AiGenerationError).detail;
    expect(detail.title).toBe('No usable AI key for this task');
    expect(detail.why).toContain('turned off');
    expect(detail.fix?.href).toBe('/settings/ai');
  });

  it('still reports no_credentials when the account genuinely has none', async () => {
    setup([], null);
    const err = await call().then(() => null, (e) => e);
    const detail = (err as AiGenerationError).detail;
    expect(detail.title).toBe('No AI provider configured');
    expect(detail.why).toContain('none is saved on your account yet');
  });
});
