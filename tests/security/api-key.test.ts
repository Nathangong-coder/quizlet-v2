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

  /**
   * Golden vector (Fix round 1, reviewer finding #4): every test above is a
   * round-trip, which passes just as happily after someone swaps AES-256-GCM
   * for a different AEAD or bumps the payload prefix to `v2:` — while every
   * real user's already-stored credential silently becomes undecryptable.
   * This pins the exact wire format against a fixed plaintext/secret/output
   * generated once with the current implementation and hardcoded here.
   *
   * IF THIS TEST FAILS: the encrypted-payload format has changed in a way
   * that is NOT backwards compatible. Every credential already stored in
   * production under the old format can no longer be decrypted. Either
   * revert the change, or ship a migration that re-encrypts existing rows
   * under the new format before deploying it.
   */
  it('decrypts a golden vector produced by the current v1 AES-256-GCM format', () => {
    const goldenSecret = 'SGVsbG8gV29ybGQhIDEyMzQ1Njc4OTBhYmNkZWZnaGk=';
    const goldenPayload = 'v1:AAECAwQFBgcICQoL:L03ggsAnwQnpkg3Rn6r0Zw==:u9+YDWZB3/VIKiuukaJ55p0aQ7NcrbjH9yfdk8h+';
    const goldenPlaintext = 'AIzaSyGoldenVectorPlaintext123';

    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = goldenSecret;
    expect(decryptApiKey(goldenPayload)).toBe(goldenPlaintext);
  });
});
