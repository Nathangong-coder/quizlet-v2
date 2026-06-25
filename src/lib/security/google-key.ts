import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Encrypts a Google API key using AES-256-GCM.
 * Payload format: v1:<iv>:<tag>:<ciphertext> (all base64)
 */
export function encryptGoogleApiKey(apiKey: string): string {
  const secretBase64 = process.env.GOOGLE_KEY_ENCRYPTION_SECRET;
  if (!secretBase64) {
    throw new Error('GOOGLE_KEY_ENCRYPTION_SECRET is not defined');
  }

  const key = Buffer.from(secretBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('GOOGLE_KEY_ENCRYPTION_SECRET must be exactly 32 bytes when decoded from base64');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(apiKey, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const tag = cipher.getAuthTag().toString('base64');

  return `v1:${iv.toString('base64')}:${tag}:${encrypted}`;
}

/**
 * Decrypts a Google API key.
 * Expects payload format: v1:<iv>:<tag>:<ciphertext>
 */
export function decryptGoogleApiKey(payload: string): string {
  const secretBase64 = process.env.GOOGLE_KEY_ENCRYPTION_SECRET;
  if (!secretBase64) {
    throw new Error('GOOGLE_KEY_ENCRYPTION_SECRET is not defined');
  }

  const key = Buffer.from(secretBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('GOOGLE_KEY_ENCRYPTION_SECRET must be exactly 32 bytes when decoded from base64');
  }

  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const encrypted = parts[3];

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Masks an API key for display.
 * e.g. AIzaSyExample123456 -> AIza****3456
 */
export function maskGoogleApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) {
    return apiKey.slice(0, 2) + '***' + apiKey.slice(-2);
  }
  return apiKey.slice(0, 4) + '****' + apiKey.slice(-4);
}
