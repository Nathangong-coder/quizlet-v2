import { describe, it, expect } from 'vitest';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/security/api-key';

// Migrated from tests/ai/google-key.test.ts (Stage 6 Task 8) when
// src/lib/security/google-key.ts — a re-export shim over this module — was
// deleted. Same coverage, testing the real names directly.
describe('API key encryption', () => {
  const testKey = 'AIzaSyExample1234567890';
  const secret = 'SGVsbG8gV29ybGQhIDEyMzQ1Njc4OTBhYmNkZWZnaGk='; // 32-byte base64 string

  it('should encrypt and decrypt a key correctly', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = secret;
    const encrypted = encryptApiKey(testKey);
    expect(encrypted).not.toBe(testKey);
    expect(decryptApiKey(encrypted)).toBe(testKey);
  });

  it('should produce different ciphertexts for the same key', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = secret;
    const enc1 = encryptApiKey(testKey);
    const enc2 = encryptApiKey(testKey);
    expect(enc1).not.toBe(enc2);
  });

  it('should throw an error for invalid payloads', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = secret;
    expect(() => decryptApiKey('invalid-payload')).toThrow();
    expect(() => decryptApiKey('v1:invalid:invalid:invalid')).toThrow();
  });

  it('should throw if the encryption secret is not 32 bytes', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = 'too-short';
    expect(() => encryptApiKey(testKey)).toThrow(/exactly 32 bytes/);
  });

  it('should mask the API key correctly', () => {
    expect(maskApiKey(testKey)).toBe('AIza****7890');
    expect(maskApiKey('short')).toBe('sh***rt');
    expect(maskApiKey('')).toBe('');
  });
});
