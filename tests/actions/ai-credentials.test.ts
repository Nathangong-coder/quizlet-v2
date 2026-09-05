import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ownership guards for the AI credential server actions.
 *
 * These are the security-critical lines in this feature: every credential id
 * arrives from the client, so each action must scope its lookup by the session
 * user and refuse ids belonging to anyone else. The assertions below check both
 * halves — that the wrong-owner id is rejected, AND that the query that decides
 * it was scoped by `userId` rather than trusting the id alone.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  upsert: vi.fn(),
  generateText: vi.fn(),
  fetchModelList: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: h.auth }));

vi.mock('@/lib/db', () => ({
  prisma: {
    aiCredential: {
      findFirst: h.findFirst,
      update: h.update,
      create: h.create,
      deleteMany: h.deleteMany,
    },
    aiTaskRouting: { upsert: h.upsert },
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('ai', () => ({ generateText: h.generateText }));
vi.mock('@/lib/ai/model-catalog', () => ({ fetchModelList: h.fetchModelList }));

import {
  saveCredential,
  saveTaskRouting,
  deleteCredential,
  listProviderModels,
  testCredential,
} from '@/actions/ai-credentials';

const OWNER = 'user-owner';
/** A real credential id — belonging to somebody else. */
const FOREIGN_ID = 'credential-of-another-user';

/** The `where` of the single scoping query each guard performs. */
function lastFindFirstWhere(): Record<string, unknown> {
  const calls = h.findFirst.mock.calls;
  return (calls[calls.length - 1][0] as { where: Record<string, unknown> }).where;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: OWNER } });
  // Scoped by userId, so another user's row simply is not found.
  h.findFirst.mockResolvedValue(null);
  h.deleteMany.mockResolvedValue({ count: 0 });
});

describe('ownership guards', () => {
  it('saveCredential refuses to edit a credential owned by another user', async () => {
    const result = await saveCredential({
      id: FOREIGN_ID,
      provider: 'google',
      label: 'Stolen',
      defaultModel: 'gemini-3.6-flash',
      role: 'primary',
      enabled: true,
    });

    expect(result).toEqual({ success: false, error: 'Credential not found' });
    expect(lastFindFirstWhere()).toEqual({ id: FOREIGN_ID, userId: OWNER });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('saveTaskRouting refuses to pin a task to another user\'s credential', async () => {
    const result = await saveTaskRouting('grade', FOREIGN_ID, null);

    expect(result).toEqual({ success: false, error: 'Credential not found' });
    expect(lastFindFirstWhere()).toEqual({ id: FOREIGN_ID, userId: OWNER });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('deleteCredential scopes the delete by userId, so a foreign id is a no-op', async () => {
    // deleteMany (not delete) is deliberate: a wrong-owner id deletes nothing
    // rather than throwing a 500 that would confirm the row exists.
    const result = await deleteCredential(FOREIGN_ID);

    expect(result.success).toBe(true);
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { id: FOREIGN_ID, userId: OWNER } });
  });

  it('listProviderModels refuses another user\'s credential and never decrypts it', async () => {
    const result = await listProviderModels(FOREIGN_ID);

    expect(result).toEqual({ success: false, error: 'Credential not found' });
    expect(lastFindFirstWhere()).toEqual({ id: FOREIGN_ID, userId: OWNER });
    expect(h.fetchModelList).not.toHaveBeenCalled();
  });

  it('testCredential refuses another user\'s credential and never calls the provider', async () => {
    const result = await testCredential(FOREIGN_ID);

    expect(result).toEqual({ success: false, error: 'Credential not found' });
    expect(lastFindFirstWhere()).toEqual({ id: FOREIGN_ID, userId: OWNER });
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it('rejects every action outright when there is no session', async () => {
    h.auth.mockResolvedValue(null);
    const unauthorized = { success: false, error: 'Unauthorized' };

    expect(await deleteCredential(FOREIGN_ID)).toEqual(unauthorized);
    expect(await listProviderModels(FOREIGN_ID)).toEqual(unauthorized);
    expect(await testCredential(FOREIGN_ID)).toEqual(unauthorized);
    expect(await saveTaskRouting('grade', FOREIGN_ID, null)).toEqual(unauthorized);
    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.deleteMany).not.toHaveBeenCalled();
  });
});

describe('saveTaskRouting model override validation', () => {
  it('rejects a model override with no credential pinned', async () => {
    // A model id is provider-specific; with no pin it would be applied to every
    // credential in a heterogeneous pool and 404 all the non-matching ones.
    const result = await saveTaskRouting('grade', null, 'gemini-3-pro');

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toMatch(/credential/i);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('accepts clearing the routing entirely', async () => {
    h.upsert.mockResolvedValue({});
    const result = await saveTaskRouting('grade', null, null);

    expect(result.success).toBe(true);
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { credentialId: null, model: null } }),
    );
  });

  it('accepts a model override alongside a credential the user owns', async () => {
    h.findFirst.mockResolvedValue({ id: 'own-1' });
    h.upsert.mockResolvedValue({});

    const result = await saveTaskRouting('grade', 'own-1', ' gemini-3-pro ');

    expect(result.success).toBe(true);
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { credentialId: 'own-1', model: 'gemini-3-pro' } }),
    );
  });
});

describe('saveTaskRouting model policy', () => {
  /** The credential the pin targets, owned by OWNER so the ownership guard passes. */
  function ownGoogleCredential(defaultModel: string) {
    h.findFirst.mockResolvedValue({ id: 'cred-1', provider: 'google', defaultModel });
  }

  /**
   * Rejecting on save AND substituting at resolve time are both deliberate.
   * The substitution keeps generation working for someone who never opens this
   * form; the rejection tells someone who DOES open it that their choice would
   * not have been honoured. Silently storing a value the engine then ignores is
   * how a settings page starts lying about what the system is doing.
   */
  it('refuses an unapproved Google model on a task whose output is stored', async () => {
    ownGoogleCredential('gemini-3.6-flash');
    const result = await saveTaskRouting('grade', 'cred-1', 'gemini-2.5-flash');

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain('not approved');
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('accepts an approved Google model', async () => {
    ownGoogleCredential('gemini-3.6-flash');
    h.upsert.mockResolvedValue({});
    const result = await saveTaskRouting('grade', 'cred-1', 'gemini-3.5-flash-lite');

    expect(result.success).toBe(true);
    expect(h.upsert).toHaveBeenCalled();
  });

  /**
   * With no override the credential's OWN default is what would run, so that is
   * what has to be checked — otherwise the form happily saves a pin that the
   * resolver then silently downgrades.
   */
  it('checks the credential default when no override is given', async () => {
    ownGoogleCredential('gemini-2.5-flash');
    const result = await saveTaskRouting('grade', 'cred-1', null);

    expect(result.success).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  /** The allowlist is Google ids; policing other providers with it would be an outage. */
  it('never restricts a non-Google credential', async () => {
    h.findFirst.mockResolvedValue({ id: 'cred-2', provider: 'openai', defaultModel: 'gpt-5.2' });
    h.upsert.mockResolvedValue({});
    const result = await saveTaskRouting('grade', 'cred-2', 'gpt-5.2-mini');

    expect(result.success).toBe(true);
    expect(h.upsert).toHaveBeenCalled();
  });
})
