import { createHmac, timingSafeEqual } from 'node:crypto';

const enc = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const dec = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Sign a stateless bearer token binding a user id to an expiry. Format:
 * `base64url(userId).expiryMs.hmac` — no server-side session store needed.
 */
export function signToken(userId: string, expiresAt: number, secret: string): string {
  const payload = `${enc(userId)}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify a token; return the user id if the signature is valid and unexpired. */
export function verifyToken(token: string, secret: string, now: number): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  const expected = sign(`${u}.${exp}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < now) return null;
  try {
    return dec(u);
  } catch {
    return null;
  }
}
