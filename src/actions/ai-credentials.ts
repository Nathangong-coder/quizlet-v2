'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { generateText } from 'ai';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/security/api-key';
import { AI_PROVIDERS, PROVIDER_META, resolveLanguageModel, type ProviderId } from '@/lib/ai/providers';
import { fetchModelList } from '@/lib/ai/model-catalog';
import { classifyProviderError, describeFailure } from '@/lib/errors/classify';
import { AI_TASKS } from '@/lib/ai/model-routing';
import { isModelAllowed, GOOGLE_APPROVED_MODELS } from '@/lib/ai/model-policy';
import { requireAdmin } from '@/lib/staff/access';
import { DEFAULT_SHARED_TOKEN_BUDGET } from '@/lib/ai/shared-budget';
import type { ActionResult } from '@/types/action';

const CredentialInput = z.object({
  id: z.string().optional(),
  provider: z.enum(AI_PROVIDERS),
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(8).optional(), // omitted when editing without rotating the key
  baseUrl: z.string().trim().url().optional().or(z.literal('')),
  defaultModel: z.string().trim().min(1).max(120),
  role: z.enum(['primary', 'backup']),
  /**
   * Free-tier or billed. Changes ROTATION, not permission: a free key is fanned
   * out across approved models because its daily cap is per project per MODEL,
   * while a paid key is used on the one model its owner chose.
   */
  tier: z.enum(['free', 'paid']),
  enabled: z.boolean(),
  /**
   * Lend this key to every user of the install, capped per borrower.
   *
   * ADMIN ONLY, enforced in `saveCredential` rather than by omitting the field
   * from the form — a server action is a public endpoint, so a control the UI
   * hides is not a control the server withholds. Both fields are optional here
   * and are simply not applied for a non-admin caller, leaving whatever the
   * row already had; rejecting the whole save would break an ordinary learner
   * editing an ordinary key through a stale client.
   */
  shared: z.boolean().optional(),
  sharedTokenBudget: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});

/**
 * Raw (not-yet-persisted) credential material. Lets a brand-new credential be
 * tested and have its models listed BEFORE it is saved — Save should never be
 * required just to find out whether a key/model works.
 */
const RawCredentialInput = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().trim().min(8),
  // Validated exactly as in CredentialInput. Letting a malformed value through
  // does NOT reach a classified provider error: `fetch` throws a bare
  // `TypeError: Failed to parse URL`, which matches no needle and lands on
  // `internal` — "not caused by your configuration", with no fix link, for a
  // two-second typo.
  baseUrl: z.string().trim().url().optional().or(z.literal('')),
  model: z.string().trim().min(1),
});

export interface CredentialRow {
  id: string; provider: string; label: string; keyHint: string;
  baseUrl: string | null; defaultModel: string; role: string; tier: string; enabled: boolean;
  shared: boolean; sharedTokenBudget: number | null;
  verifiedAt: string | null; lastUsedAt: string | null; lastErrorKind: string | null;
}

/** Every lookup is scoped by userId so one user can never reach another's row. */
async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function listCredentials(): Promise<ActionResult<CredentialRow[]>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    const rows = await prisma.aiCredential.findMany({
      where: { userId },
      orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id, provider: r.provider, label: r.label, keyHint: r.keyHint,
        baseUrl: r.baseUrl, defaultModel: r.defaultModel, role: r.role, tier: r.tier, enabled: r.enabled,
        shared: r.shared, sharedTokenBudget: r.sharedTokenBudget,
        verifiedAt: r.verifiedAt?.toISOString() ?? null,
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        lastErrorKind: r.lastErrorKind,
      })),
    };
  } catch (error) {
    console.error('List credentials error:', error);
    return { success: false, error: 'Failed to load credentials' };
  }
}

export async function saveCredential(
  input: z.infer<typeof CredentialInput>,
): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const parsed = CredentialInput.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid credential details' };
  const v = parsed.data;

  const baseUrl = v.baseUrl?.trim() || PROVIDER_META[v.provider].defaultBaseUrl || null;
  if (PROVIDER_META[v.provider].requiresBaseUrl && !baseUrl) {
    return { success: false, error: `${PROVIDER_META[v.provider].label} requires a base URL.` };
  }

  // Sharing spends the owner's money on other people's requests, so only an
  // admin may turn it on — and only through the gate, never through the shape
  // of the request. A non-admin's `shared` field is dropped, which leaves an
  // already-shared row shared: revoking is also an admin action.
  const sharing =
    (await requireAdmin()) && v.shared !== undefined
      ? {
          shared: v.shared,
          // A shared key with no cap is the runaway this whole mechanism
          // exists to prevent, so turning sharing on always lands a budget.
          sharedTokenBudget: v.shared
            ? (v.sharedTokenBudget ?? DEFAULT_SHARED_TOKEN_BUDGET)
            : v.sharedTokenBudget ?? null,
        }
      : {};

  try {
    if (v.id) {
      // Editing. Only re-encrypt when a new key was actually supplied, so
      // saving other fields does not require re-entering the key.
      const existing = await prisma.aiCredential.findFirst({
        where: { id: v.id, userId }, select: { id: true },
      });
      if (!existing) return { success: false, error: 'Credential not found' };

      await prisma.aiCredential.update({
        where: { id: v.id },
        data: {
          label: v.label, baseUrl, defaultModel: v.defaultModel,
          role: v.role, tier: v.tier, enabled: v.enabled, ...sharing,
          ...(v.apiKey
            ? {
                encryptedApiKey: encryptApiKey(v.apiKey),
                keyHint: maskApiKey(v.apiKey),
                verifiedAt: null, lastErrorAt: null, lastErrorKind: null,
              }
            : {}),
        },
      });
      revalidatePath('/settings/ai');
      return { success: true, data: { id: v.id } };
    }

    if (!v.apiKey) return { success: false, error: 'An API key is required.' };

    const created = await prisma.aiCredential.create({
      data: {
        userId, provider: v.provider, label: v.label,
        encryptedApiKey: encryptApiKey(v.apiKey), keyHint: maskApiKey(v.apiKey),
        baseUrl, defaultModel: v.defaultModel, role: v.role, tier: v.tier, enabled: v.enabled,
        ...sharing,
      },
      select: { id: true },
    });
    revalidatePath('/settings/ai');
    return { success: true, data: { id: created.id } };
  } catch (error) {
    console.error('Save credential error:', error);
    return { success: false, error: 'Failed to save credential' };
  }
}

/**
 * May the current user lend a key to everybody? Renders the sharing control.
 *
 * A separate call rather than a field on `CredentialRow` because it is a
 * property of the VIEWER, not of any row, and repeating it per row invites a
 * future reader to think one key might be shareable while another is not. It
 * is a hint for the UI only — `saveCredential` re-derives it.
 */
export async function canShareCredentials(): Promise<boolean> {
  return (await requireAdmin()) !== null;
}

export async function deleteCredential(id: string): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    // deleteMany (not delete) so a wrong-owner id is a no-op, never a 500.
    await prisma.aiCredential.deleteMany({ where: { id, userId } });
    revalidatePath('/settings/ai');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('Delete credential error:', error);
    return { success: false, error: 'Failed to delete credential' };
  }
}

export async function listProviderModels(id: string): Promise<ActionResult<string[]>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    const cred = await prisma.aiCredential.findFirst({ where: { id, userId } });
    if (!cred) return { success: false, error: 'Credential not found' };
    const models = await fetchModelList(
      cred.provider as ProviderId, decryptApiKey(cred.encryptedApiKey), cred.baseUrl,
    );
    return { success: true, data: models };
  } catch (error) {
    console.error('List provider models error:', error);
    return { success: false, error: 'Failed to list models' };
  }
}

/**
 * Verifies a credential with a REAL generation call.
 *
 * A listing call is not sufficient: gemini-2.5-flash appears in Google's
 * ListModels yet returns 404 from generateContent, so listing would pass a
 * model that cannot actually serve a request.
 */
export async function testCredential(id: string, model?: string): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const cred = await prisma.aiCredential.findFirst({ where: { id, userId } });
  if (!cred) return { success: false, error: 'Credential not found' };

  try {
    await generateText({
      model: resolveLanguageModel({
        provider: cred.provider as ProviderId,
        apiKey: decryptApiKey(cred.encryptedApiKey),
        baseUrl: cred.baseUrl,
        model: model?.trim() || cred.defaultModel,
      }),
      prompt: 'Reply with the single word: ok',
    });

    await prisma.aiCredential.update({
      where: { id: cred.id },
      data: { verifiedAt: new Date(), lastErrorAt: null, lastErrorKind: null },
    });
    revalidatePath('/settings/ai');
    return { success: true, data: undefined };
  } catch (err) {
    const kind = classifyProviderError(err);
    const described = describeFailure(kind);
    await prisma.aiCredential.update({
      where: { id: cred.id },
      data: { verifiedAt: null, lastErrorAt: new Date(), lastErrorKind: kind },
    });
    revalidatePath('/settings/ai');
    return {
      success: false,
      error: described.title,
      detail: { ...described, technical: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Same real-call verification as `testCredential`, but against raw key
 * material that has not been saved yet — so a brand-new credential can be
 * checked before Save, not only after.
 */
export async function testRawCredential(
  input: z.infer<typeof RawCredentialInput>,
): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const parsed = RawCredentialInput.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid credential details' };
  const v = parsed.data;

  if (PROVIDER_META[v.provider].requiresBaseUrl && !v.baseUrl?.trim()) {
    return { success: false, error: `${PROVIDER_META[v.provider].label} requires a base URL.` };
  }

  try {
    await generateText({
      model: resolveLanguageModel({
        provider: v.provider,
        apiKey: v.apiKey,
        baseUrl: v.baseUrl || null,
        model: v.model,
      }),
      prompt: 'Reply with the single word: ok',
    });
    return { success: true, data: undefined };
  } catch (err) {
    const kind = classifyProviderError(err);
    const described = describeFailure(kind);
    return {
      success: false,
      error: described.title,
      detail: { ...described, technical: err instanceof Error ? err.message : String(err) },
    };
  }
}

/** Lists models for raw (not-yet-persisted) key material — see `testRawCredential`. */
export async function listRawProviderModels(
  input: Omit<z.infer<typeof RawCredentialInput>, 'model'>,
): Promise<ActionResult<string[]>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const parsed = RawCredentialInput.omit({ model: true }).safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid credential details' };
  const v = parsed.data;

  try {
    const models = await fetchModelList(v.provider, v.apiKey, v.baseUrl || null);
    return { success: true, data: models };
  } catch (error) {
    console.error('List raw provider models error:', error);
    return { success: false, error: 'Failed to list models' };
  }
}

export async function listTaskRoutings(): Promise<
  ActionResult<{ task: string; credentialId: string | null; model: string | null }[]>
> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };
  try {
    const rows = await prisma.aiTaskRouting.findMany({ where: { userId } });
    return {
      success: true,
      data: rows.map((r) => ({ task: r.task, credentialId: r.credentialId, model: r.model })),
    };
  } catch (error) {
    console.error('List task routings error:', error);
    return { success: false, error: 'Failed to load task routing' };
  }
}

export async function saveTaskRouting(
  task: string, credentialId: string | null, model: string | null,
): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const TaskName = z.enum(AI_TASKS);
  const parsedTask = TaskName.safeParse(task);
  if (!parsedTask.success) return { success: false, error: 'Unknown task' };

  // A model override with no credential is not a meaningful configuration: a
  // model id is provider-specific, so with no pin `generateJson` would have to
  // either ignore it or send e.g. `gemini-3-pro` to an Anthropic key, 404 it,
  // and badge a healthy credential as broken. Rejected here so the state
  // cannot even be stored.
  const trimmedModel = model?.trim() || null;
  if (trimmedModel && !credentialId) {
    return { success: false, error: 'Choose a credential before overriding its model.' };
  }

  try {
    // Guard cross-user assignment: the credential must belong to this user.
    if (credentialId) {
      const owned = await prisma.aiCredential.findFirst({
        where: { id: credentialId, userId }, select: { id: true, provider: true, defaultModel: true },
      });
      if (!owned) return { success: false, error: 'Credential not found' };

      // Reject an unapproved model AT SAVE TIME as well as substituting it at
      // resolve time. Both exist on purpose: the substitution keeps generation
      // working for someone who never opens this form, and the rejection tells
      // someone who DOES open it that their choice would not have been honoured
      // — silently accepting a value the engine then ignores is how a settings
      // page starts lying about what the system is doing.
      const chosenModel = trimmedModel ?? owned.defaultModel;
      if (!isModelAllowed(owned.provider, chosenModel, parsedTask.data)) {
        return {
          success: false,
          error:
            `${chosenModel} is not approved for ${parsedTask.data}. This task writes results that are ` +
            `stored and reused, so Google credentials are limited to: ${GOOGLE_APPROVED_MODELS.join(', ')}.`,
        };
      }
    }

    await prisma.aiTaskRouting.upsert({
      where: { userId_task: { userId, task: parsedTask.data } },
      update: { credentialId, model: trimmedModel },
      create: { userId, task: parsedTask.data, credentialId, model: trimmedModel },
    });
    revalidatePath('/settings/ai');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('Save task routing error:', error);
    return { success: false, error: 'Failed to save task routing' };
  }
}
