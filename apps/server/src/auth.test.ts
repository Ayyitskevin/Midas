import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProvider } from './providers';
import { buildApp } from './app';
import { AlertRepo } from './alerts/repo';
import { UserRepo } from './auth/users';
import { hashPassword, verifyPassword } from './auth/password';
import { signToken, verifyToken } from './auth/token';

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
