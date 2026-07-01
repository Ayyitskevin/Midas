import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * At-rest encryption for per-user exchange keys — AES-256-GCM with a key
 * derived (scrypt) from the operator's MIDAS_KEYS_KMS_SECRET. GCM gives us
 * tamper detection for free: a modified record fails to decrypt rather than
 * yielding silently-corrupted credentials. Per-record random IV; the derived
 * key is computed once per secret (scrypt is deliberately slow).
 *
 * Threat model: protects key material in backups / on disk / in the DB a
 * hosted deployment swaps in. It does NOT protect against an attacker who
 * already has the running process's env (they'd have the KMS secret too) —
 * that boundary is the host, same as MIDAS_AUTH_SECRET.
 */

const ALGO = 'aes-256-gcm';
const SALT = 'midas-user-keys-v1'; // versioned, fixed: one derived key per KMS secret

const keyCache = new Map<string, Buffer>();

function deriveKey(kmsSecret: string): Buffer {
  let key = keyCache.get(kmsSecret);
  if (!key) {
    key = scryptSync(kmsSecret, SALT, 32);
    keyCache.set(kmsSecret, key);
  }
  return key;
}

/** Encrypt UTF-8 text → compact `iv.tag.ciphertext` (base64url segments). */
export function encryptText(plain: string, kmsSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, deriveKey(kmsSecret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

/** Decrypt; returns null (never throws) on tampering, truncation or a wrong secret. */
export function decryptText(stored: string, kmsSecret: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = stored.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv(ALGO, deriveKey(kmsSecret), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
