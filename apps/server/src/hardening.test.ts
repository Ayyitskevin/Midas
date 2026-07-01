import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  app = await buildApp(createProvider('mock'), {
    auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('security response headers', () => {
  it('are set on every API response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('are present even on errors', async () => {
    // With auth enabled the guard answers 401 before the 404 handler —
    // either way it is an error response, and the headers must be there.
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

describe('login throttling', () => {
  it('answers repeated failed logins with 429 before the store is even consulted', async () => {
    // Bootstrap a user, then hammer wrong passwords from one (test) ip.
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'trader', password: 'correct-horse' },
    });
    expect(signup.statusCode).toBe(201);

    let throttled = 0;
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'trader', password: `wrong-${i}` },
      });
      if (res.statusCode === 429) throttled += 1;
      else expect(res.statusCode).toBe(401);
    }
    expect(throttled).toBeGreaterThan(0); // default threshold is 5 fails

    // The right password is ALSO throttled while locked out — that is the point.
    const during = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'trader', password: 'correct-horse' },
    });
    expect(during.statusCode).toBe(429);
    expect(during.json().message).toMatch(/try again in \d+s/i);
  });

  it('does not let one username lock out a different one', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'other', password: 'correct-horse' },
    });
    expect(signup.statusCode).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'other', password: 'correct-horse' },
    });
    expect(res.statusCode).toBe(200); // 'trader' being locked doesn't touch 'other'
  });
});
