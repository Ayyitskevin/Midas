import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hash a password as `saltHex:keyHex` using scrypt (no external deps). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/** Verify a password against a stored `saltHex:keyHex` hash, in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, 'hex');
  } catch {
    return false;
  }
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'));
  return key.length === expected.length && timingSafeEqual(key, expected);
}
