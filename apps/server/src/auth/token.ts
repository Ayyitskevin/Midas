import { createHmac, timingSafeEqual } from 'node:crypto';

const enc = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const dec = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** The claims carried by a verified token. */
export interface TokenClaims {
  userId: string;
  /** The user's token version when this token was issued (for revocation). */
  version: number;
}

/**
 * Sign a stateless bearer token binding a user id + token version to an expiry.
 * Format: `base64url(userId).version.expiryMs.hmac` — no server-side session
 * store needed. Bumping the user's version invalidates every token issued at an
 * older version (the "sign out other devices" mechanism).
 */
export function signToken(userId: string, version: number, expiresAt: number, secret: string): string {
  const payload = `${enc(userId)}.${version}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify a token; return its claims if the signature is valid and unexpired. */
export function verifyToken(token: string, secret: string, now: number): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [u, ver, exp, sig] = parts;
  const expected = sign(`${u}.${ver}.${exp}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expiry = Number(exp);
  const version = Number(ver);
  if (!Number.isFinite(expiry) || expiry < now || !Number.isFinite(version)) return null;
  try {
    return { userId: dec(u), version };
  } catch {
    return null;
  }
}
