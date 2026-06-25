import { describe, it, expect } from 'vitest';
import { encryptGoogleApiKey, decryptGoogleApiKey, maskGoogleApiKey } from '@/lib/security/google-key';

describe('Google API Key Encryption', () => {
  const testKey = 'AIzaSyExample1234567890';
  const secret = 'SGVsbG8gV29ybGQhIDEyMzQ1Njc4OTBhYmNkZWZnaGk='; // 32-byte base64 string

  it('should encrypt and decrypt a key correctly', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = secret;
    const encrypted = encryptGoogleApiKey(testKey);
    expect(encrypted).not.toBe(testKey);
    expect(decryptGoogleApiKey(encrypted)).toBe(testKey);
  });

  it('should produce different ciphertexts for the same key', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = secret;
    const enc1 = encryptGoogleApiKey(testKey);
    const enc2 = encryptGoogleApiKey(testKey);
    expect(enc1).not.toBe(enc2);
  });

  it('should throw an error for invalid payloads', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = secret;
    expect(() => decryptGoogleApiKey('invalid-payload')).toThrow();
    expect(() => decryptGoogleApiKey('v1:invalid:invalid:invalid')).toThrow();
  });

  it('should throw if the encryption secret is not 32 bytes', () => {
    process.env.GOOGLE_KEY_ENCRYPTION_SECRET = 'too-short';
    expect(() => encryptGoogleApiKey(testKey)).toThrow(/exactly 32 bytes/);
  });

  it('should mask the API key correctly', () => {
    expect(maskGoogleApiKey(testKey)).toBe('AIza****7890');
    expect(maskGoogleApiKey('short')).toBe('sh***rt');
    expect(maskGoogleApiKey('')).toBe('');
  });
});
