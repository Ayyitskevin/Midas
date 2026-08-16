/**
 * Guards for the boundaries `docs/SECURITY_HARDENING.md` claims are "verified
 * by tests" but which no test actually held.
 *
 * Found by mutation: each boundary below was deliberately broken in the source
 * and the whole server suite re-run. Eleven boundaries went red as they should
 * (placement hold, cancel ownership, snapshot cap, WS frame cap, exchange
 * allowlist, keyed-account fail-closed, key encryption at rest, key metadata
 * redaction, webhook SSRF, webhook payload cap, webhook deadline). These five
 * did not — the suite stayed fully green with the boundary removed:
 *
 *   1. token verification's `timingSafeEqual` replaced with a string compare
 *   2. password verification's `timingSafeEqual` replaced with a string compare
 *   3. login short-circuited for an unknown user (enumeration by response time)
 *   4. the per-socket subscription ceiling deleted
 *   5. the per-IP subscription quota's CALL SITE deleted
 *
 * (5) is the instructive one: `createIpQuota` had solid unit tests, so the
 * quota logic was well covered while the fact that the server *uses* it was
 * not. A tool can be tested thoroughly and still not be installed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitSubscription, createIpQuota } from './streaming';

const src = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

/**
 * Source with `import` lines removed. Asserting a bare identifier would pass on
 * the import alone — the first draft of this file did exactly that, and the
 * token mutation walked straight through it. What matters is that the
 * primitive is still CALLED.
 */
const body = (rel: string): string =>
  src(rel)
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n');

/**
 * Constant-time comparison is a *timing* property, and asserting wall-clock
 * timing in unit tests is flaky by nature. These are therefore deliberately
 * structural: they prove the constant-time primitive is still the one being
 * used, which is exactly what the mutations removed. They do not prove the
 * compiled result is empirically constant-time — no cheap test can — and this
 * file should not be read as claiming otherwise.
 */
describe('auth is timing-safe (structural)', () => {
  it('verifies session tokens by CALLING timingSafeEqual', () => {
    const token = body('auth/token.ts');
    expect(token).toMatch(/timingSafeEqual\s*\(/);
    // The mutation swapped in `a.toString('hex') !== b.toString('hex')`, which
    // returns on the first differing byte and leaks signature bytes by timing.
    // Any hex/base64 stringify compared with ===/!== is that same shape.
    expect(token).not.toMatch(/\.toString\((['"`])(hex|base64)\1\)\s*[!=]==/);
  });

  it('verifies passwords by CALLING timingSafeEqual', () => {
    const password = body('auth/password.ts');
    expect(password).toMatch(/timingSafeEqual\s*\(/);
    expect(password).not.toMatch(/\.toString\((['"`])(hex|base64)\1\)\s*[!=]==/);
  });
});

/**
 * The enumeration guard IS behavioral, so it is tested behaviorally: the login
 * route must run the same scrypt comparison whether or not the username
 * exists. `DUMMY_PASSWORD_HASH` is the mechanism — its presence at the call
 * site is what stops an unknown user returning measurably faster.
 */
describe('login does not leak account existence', () => {
  it('compares against a dummy hash when the user does not exist', () => {
    const routes = src('auth/routes.ts');
    // The mutation replaced this with `user ? await verifyPassword(...) : false`,
    // which returns immediately for an unknown username.
    expect(routes).toContain('DUMMY_PASSWORD_HASH');
    expect(routes).toMatch(/verifyPassword\(\s*candidate\s*,\s*user\?\.passwordHash\s*\?\?\s*DUMMY_PASSWORD_HASH\s*\)/);
  });

  it('spends real scrypt work on an unknown user, not an early return', async () => {
    const { verifyPassword, DUMMY_PASSWORD_HASH } = await import('./auth/password');
    // The dummy hash must be a genuine scrypt record, not a sentinel that
    // verifyPassword can reject cheaply — otherwise the guard is cosmetic.
    expect(DUMMY_PASSWORD_HASH).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    await expect(verifyPassword('whatever', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});

describe('WebSocket subscription ceilings are enforced, not merely defined', () => {
  let quota: ReturnType<typeof createIpQuota>;
  beforeEach(() => {
    quota = createIpQuota(120);
  });

  it('admits a subscription below both ceilings', () => {
    expect(admitSubscription(0, '10.0.0.1', quota)).toEqual({ ok: true });
  });

  it('holds the documented ceilings by DEFAULT, not just when passed explicitly', () => {
    // Every other case here passes limits as arguments, which leaves the
    // shipped constants unpinned — raising MAX_SUBS_PER_SOCKET to 100000 kept
    // the suite green. These two calls take the defaults.
    expect(admitSubscription(59, '10.0.0.9', createIpQuota(120))).toEqual({ ok: true });
    const atCeiling = admitSubscription(60, '10.0.0.9', createIpQuota(120));
    expect(atCeiling.ok, 'per-socket ceiling must default to 60').toBe(false);
    expect(atCeiling.ok === false && atCeiling.reason).toBe('per-socket');
    expect(atCeiling.ok === false && atCeiling.message).toContain('60 per connection');
  });

  it('holds the default per-IP ceiling across sockets', () => {
    const shared = createIpQuota(120);
    // 120 admissions on a fresh socket each time (heldOnSocket 0) must all pass
    // under the default, and the 121st must not.
    for (let i = 0; i < 120; i++) {
      expect(admitSubscription(0, '10.0.0.10', shared).ok, `admission ${i}`).toBe(true);
    }
    const over = admitSubscription(0, '10.0.0.10', shared);
    expect(over.ok, 'per-IP ceiling must default to 120').toBe(false);
    expect(over.ok === false && over.message).toContain('120 per client');
  });

  it('refuses once the socket is at its own ceiling', () => {
    const res = admitSubscription(60, '10.0.0.1', quota, 60);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('per-socket');
  });

  it('does not spend an IP slot when the per-socket ceiling already refuses', () => {
    // Ordering matters: charging the shared per-IP budget for a subscription
    // this socket can never hold would let one client starve others simply by
    // hammering a saturated connection.
    admitSubscription(60, '10.0.0.1', quota, 60);
    expect(quota.countFor('10.0.0.1')).toBe(0);
  });

  it('refuses once the client IP is at its quota, across sockets', () => {
    const small = createIpQuota(2);
    expect(admitSubscription(0, '10.0.0.2', small, 60, 2)).toEqual({ ok: true });
    expect(admitSubscription(0, '10.0.0.2', small, 60, 2)).toEqual({ ok: true });
    // A third, on a *different* socket (heldOnSocket back to 0) must still be
    // refused — the per-IP budget spans every socket the client opens.
    const res = admitSubscription(0, '10.0.0.2', small, 60, 2);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('per-ip');
  });

  it('is actually consulted by the socket handler', () => {
    // The gap this whole file exists for: deleting either guard from the
    // handler left every test green, because both were unreachable inline
    // code. Pin the call site itself.
    const streaming = src('streaming.ts');
    expect(streaming).toMatch(/admitSubscription\(\s*held\.size\s*,\s*ip\s*,\s*ipQuota\s*\)/);
    expect(streaming).toContain('if (!admission.ok)');
  });
});

describe('mutation coverage is recorded where it can be checked', () => {
  it('keeps the hardening doc honest about which guarantees are pinned', () => {
    const doc = readFileSync(join(__dirname, '../../../docs/SECURITY_HARDENING.md'), 'utf8');
    // The doc asserts every listed guarantee has a test that fails CI. That
    // sentence is only true while this file exists, so tie them together.
    expect(doc).toContain('securityBoundaries.test.ts');
  });
});
