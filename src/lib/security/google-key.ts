// Re-exported from src/lib/security/api-key.ts, which generalises this
// crypto beyond Google (Stage 6 Task 5). Kept for existing importers until
// Task 8 deletes this file.
export {
  encryptApiKey as encryptGoogleApiKey,
  decryptApiKey as decryptGoogleApiKey,
  maskApiKey as maskGoogleApiKey,
} from './api-key';
