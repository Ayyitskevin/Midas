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

  it('verifies a freshly signed token', () => {
    const token = signToken('usr_1', now + 1000, secret);
    expect(verifyToken(token, secret, now)).toBe('usr_1');
  });

  it('rejects a tampered or wrong-secret token', () => {
    const token = signToken('usr_1', now + 1000, secret);
    expect(verifyToken(token + 'x', secret, now)).toBeNull();
    expect(verifyToken(token, 'other', now)).toBeNull();
  });

  it('rejects an expired token and malformed input', () => {
    expect(verifyToken(signToken('usr_1', now - 1, secret), secret, now)).toBeNull();
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
