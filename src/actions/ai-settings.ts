'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { encryptGoogleApiKey, decryptGoogleApiKey, maskGoogleApiKey } from '@/lib/security/google-key';
import { revalidatePath } from 'next/cache';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DEFAULT_AI_MODEL } from '@/lib/ai/model-routing';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function saveGoogleApiKey(apiKey: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  if (!apiKey || apiKey.length < 10) {
    return { success: false, error: 'Invalid API key format' };
  }

  try {
    // Test the key first using the project's default model
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: DEFAULT_AI_MODEL });
    await model.generateContent("Hi");

    const encrypted = encryptGoogleApiKey(apiKey);
    const keyHint = `AIza****${apiKey.slice(-4)}`;

    await prisma.aiCredential.upsert({
      where: { userId: session.user.id },
      update: {
        encryptedApiKey: encrypted,
        keyHint,
        verifiedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        encryptedApiKey: encrypted,
        keyHint,
        verifiedAt: new Date(),
      },
    });

    revalidatePath('/settings/ai');
    return { success: true };
  } catch (error: any) {
    console.error('Error saving Google API key:', error);
    if (error.message?.includes('API key not valid')) {
      return { success: false, error: 'The provided Google API key is invalid.' };
    }
    return { success: false, error: 'Failed to save API key. Please try again.' };
  }
}

export async function deleteGoogleApiKey(): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.aiCredential.delete({
      where: { userId: session.user.id },
    });

    revalidatePath('/settings/ai');
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting Google API key:', error);
    return { success: false, error: 'Failed to delete API key.' };
  }
}

export async function testGoogleApiKey(apiKey?: string): Promise<ActionResult<void>> {
  if (!apiKey) {
    return { success: false, error: 'No API key provided for testing' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: DEFAULT_AI_MODEL });
    await model.generateContent("Hi");

    return { success: true };
  } catch (error: any) {
    console.error('Error testing Google API key:', error);
    return { success: false, error: 'Invalid API key' };
  }
}

export async function getGoogleApiKeyStatus(): Promise<ActionResult<{ keyHint: string | null }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const credential = await prisma.aiCredential.findUnique({
      where: { userId: session.user.id },
    });

    return {
      success: true,
      data: { keyHint: credential?.keyHint || null },
    };
  } catch (error: any) {
    console.error('Error fetching Google API key status:', error);
    return { success: false, error: 'Failed to fetch API key status.' };
  }
}
