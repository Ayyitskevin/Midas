import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProvider } from './providers';
import { buildApp } from './app';
import { AlertRepo } from './alerts/repo';
import { UserRepo } from './auth/users';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from './auth/password';
import { signToken, verifyToken } from './auth/token';
import { isPublicPath } from './auth/guard';
import { signupCredentialError } from './auth/routes';

describe('auth guard public-path matching', () => {
  it('is public only on segment boundaries', () => {
    // The intended public surfaces.
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/api/stream')).toBe(true);
    expect(isPublicPath('/api/auth')).toBe(true);
    expect(isPublicPath('/api/auth/login')).toBe(true);
    // Lookalikes that a plain startsWith() would have leaked unauthenticated.
    expect(isPublicPath('/api/health-internal')).toBe(false);
    expect(isPublicPath('/api/streamers')).toBe(false);
    expect(isPublicPath('/api/authz')).toBe(false);
    // Genuinely protected routes stay guarded.
    expect(isPublicPath('/api/orders')).toBe(false);
    expect(isPublicPath('/api/account/keys')).toBe(false);
  });
});

describe('login username-enumeration resistance', () => {
  it('DUMMY_PASSWORD_HASH is a well-formed hash that no password matches', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword('', DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword('password', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe('password hashing', () => {
  it('round-trips a password and rejects the wrong one', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword('hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects a malformed hash', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('signupCredentialError (length bounds, before scrypt)', () => {
  it('accepts in-bounds credentials', () => {
    expect(signupCredentialError('alice', 'hunter2')).toBeNull();
  });

  it('rejects an over-long password so it never reaches scrypt', () => {
    expect(signupCredentialError('alice', 'x'.repeat(257))).toMatch(/256/);
  });

  it('rejects an over-long or empty username', () => {
    expect(signupCredentialError('a'.repeat(65), 'hunter2')).toMatch(/64/);
    expect(signupCredentialError('', 'hunter2')).toMatch(/1/);
  });

  it('still rejects a too-short password', () => {
    expect(signupCredentialError('alice', 'x')).toMatch(/6/);
  });
});

describe('session tokens', () => {
  const secret = 'test-secret';
  const now = 1_000_000;

  it('verifies a freshly signed token and carries its version', () => {
    const token = signToken('usr_1', 3, now + 1000, secret);
    expect(verifyToken(token, secret, now)).toEqual({ userId: 'usr_1', version: 3 });
  });

  it('rejects a tampered or wrong-secret token', () => {
    const token = signToken('usr_1', 0, now + 1000, secret);
    expect(verifyToken(token + 'x', secret, now)).toBeNull();
    expect(verifyToken(token, 'other', now)).toBeNull();
  });

  it('rejects an expired token and malformed input', () => {
    expect(verifyToken(signToken('usr_1', 0, now - 1, secret), secret, now)).toBeNull();
    expect(verifyToken('not.a.token', secret, now)).toBeNull();
  });
});

describe('auth API + guard', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      alertRepo: new AlertRepo(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('reports status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.json()).toMatchObject({ enabled: true, allowSignup: true });
  });

  it('signs up, signs in, and identifies the user', async () => {
    let res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'alice', password: 'hunter2' },
    });
    expect(res.statusCode).toBe(201);
    const session = res.json();
    expect(session.user.username).toBe('alice');
    expect(typeof session.token).toBe('string');

    res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(session.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('alice');

    res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);

    res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'hunter2' },
    });
    expect(res.statusCode).toBe(200);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('gives an unknown user the SAME 401 body as a wrong password (no enumeration oracle)', async () => {
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'does-not-exist', password: 'whatever1' },
    });
    const wrongPass = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong-password' },
    });
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPass.statusCode).toBe(401);
    // Identical message: the response cannot reveal which usernames exist.
    // (Timing parity is handled by always running a scrypt verify — see the
    // DUMMY_PASSWORD_HASH path in the login route.)
    expect(unknownUser.json().message).toBe(wrongPass.json().message);
  });

  it('rejects a duplicate username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'alice', password: 'another1' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('guards protected routes but leaves health + stream public', async () => {
    const blocked = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(blocked.statusCode).toBe(401);

    const session = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'alice', password: 'hunter2' },
      })
    ).json();
    const ok = await app.inject({ method: 'GET', url: '/api/alerts', headers: auth(session.token) });
    expect(ok.statusCode).toBe(200);

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
  });
});

describe('account management', () => {
  let app: FastifyInstance;
  let aliceToken: string; // first user → admin
  let aliceId: string;
  let bobToken: string;
  let bobId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const signup = async (username: string, password: string) =>
    (await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username, password } })).json();
  const me = (t: string) => app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(t) });

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      alertRepo: new AlertRepo(),
    });
    await app.ready();
    const a = await signup('alice', 'hunter2');
    aliceToken = a.token;
    aliceId = a.user.id;
    const b = await signup('bob', 'hunter2');
    bobToken = b.token;
    bobId = b.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('makes the first user an admin and others not', async () => {
    expect((await me(aliceToken)).json().isAdmin).toBe(true);
    expect(Boolean((await me(bobToken)).json().isAdmin)).toBe(false);
  });

  it('lists users for an admin and forbids non-admins', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/auth/users', headers: auth(aliceToken) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().map((u: { username: string }) => u.username).sort()).toEqual(['alice', 'bob']);

    const no = await app.inject({ method: 'GET', url: '/api/auth/users', headers: auth(bobToken) });
    expect(no.statusCode).toBe(403);
  });

  it('changes a password, rotating old tokens', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: auth(bobToken),
      payload: { currentPassword: 'nope', newPassword: 'newpass1' },
    });
    expect(wrong.statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: auth(bobToken),
      payload: { currentPassword: 'hunter2', newPassword: 'newpass1' },
    });
    expect(res.statusCode).toBe(200);
    const fresh = res.json().token as string;

    expect((await me(bobToken)).statusCode).toBe(401); // old token revoked
    expect((await me(fresh)).statusCode).toBe(200);

    const good = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'newpass1' } });
    expect(good.statusCode).toBe(200);
    const old = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'hunter2' } });
    expect(old.statusCode).toBe(401);

    bobToken = fresh;
  });

  it('signs out other devices via token rotation', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout-all', headers: auth(aliceToken) });
    expect(res.statusCode).toBe(200);
    const fresh = res.json().token as string;
    expect((await me(aliceToken)).statusCode).toBe(401);
    expect((await me(fresh)).statusCode).toBe(200);
    aliceToken = fresh;
  });

  it('lets an admin remove another user but not themselves', async () => {
    const self = await app.inject({ method: 'DELETE', url: `/api/auth/users/${aliceId}`, headers: auth(aliceToken) });
    expect(self.statusCode).toBe(400);

    const nonAdmin = await app.inject({ method: 'DELETE', url: `/api/auth/users/${aliceId}`, headers: auth(bobToken) });
    expect(nonAdmin.statusCode).toBe(403);

    const del = await app.inject({ method: 'DELETE', url: `/api/auth/users/${bobId}`, headers: auth(aliceToken) });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/auth/users', headers: auth(aliceToken) });
    expect(list.json().map((u: { username: string }) => u.username)).toEqual(['alice']);
  });
});

describe('auth disabled (default)', () => {
  it('leaves the API open', async () => {
    const app = await buildApp(createProvider('mock'), {
      auth: { enabled: false },
      userRepo: new UserRepo(),
      alertRepo: new AlertRepo(),
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('signup hardening (DoS brakes)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      alertRepo: new AlertRepo(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an over-long password with 400 (before scrypt runs)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'bigpass', password: 'x'.repeat(300) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/256/);
  });

  it('throttles repeated signups from one IP with 429', async () => {
    // A too-short password still counts toward the per-IP window cap, so this
    // exercises the limiter with no scrypt work. Early requests pass the limiter
    // and fail the length check (400); past the cap the route short-circuits 429.
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { username: `spam${i}`, password: 'x' },
      });
      codes.push(res.statusCode);
    }
    expect(codes).toContain(400);
    expect(codes[codes.length - 1]).toBe(429);
  });
});
