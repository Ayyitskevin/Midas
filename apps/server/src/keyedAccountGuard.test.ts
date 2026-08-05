/**
 * The keyed-account fail-closed posture, canonically, against the real
 * `buildApp`: with auth disabled AND a wildcard CORS origin, any web page the
 * operator visits could otherwise read the keyed account — and cancel its
 * resting orders (cancel-only DELETE is live) — cross-origin. So the keyed
 * surfaces (balances/orders/positions/fills/equity, single-order read, and
 * DELETE /api/orders/:id) answer an honest 403 pointing at
 * MIDAS_AUTH_ENABLED / MIDAS_CORS_ORIGIN. The accepted postures keep working:
 * auth ON (auth guard governs), or auth off with a PINNED origin. Public
 * market data and the TradingSafetyHold contract are untouched.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';
import { UserRepo } from './auth/users';
import { corsOriginIsWildcard, isKeyedAccountPath } from './auth/guard';

const PINNED_ORIGIN = 'http://localhost:8080';

describe('keyed-account guard unit matchers', () => {
  it('treats *, empty, and list-embedded * as wildcard — nothing else', () => {
    expect(corsOriginIsWildcard('*')).toBe(true);
    expect(corsOriginIsWildcard('')).toBe(true); // unset resolves to '*' in config
    expect(corsOriginIsWildcard('https://a.example, *')).toBe(true);
    expect(corsOriginIsWildcard(PINNED_ORIGIN)).toBe(false);
    expect(corsOriginIsWildcard('https://a.example,https://b.example')).toBe(false);
  });

  it('classifies keyed account paths on segment boundaries, method-aware for orders', () => {
    for (const path of [
      '/api/balances',
      '/api/positions',
      '/api/fills',
      '/api/account/events',
      '/api/account/equity',
    ]) {
      expect(isKeyedAccountPath(path, 'GET')).toBe(true);
    }
    expect(isKeyedAccountPath('/api/orders', 'GET')).toBe(true);
    expect(isKeyedAccountPath('/api/orders/demo-1', 'GET')).toBe(true);
    expect(isKeyedAccountPath('/api/orders/demo-1', 'DELETE')).toBe(true);
    // POST /api/orders stays with the 503 TradingSafetyHold contract.
    expect(isKeyedAccountPath('/api/orders', 'POST')).toBe(false);
    // Lookalikes and non-account surfaces are not keyed.
    expect(isKeyedAccountPath('/api/balancesheet', 'GET')).toBe(false);
    expect(isKeyedAccountPath('/api/ordersx', 'GET')).toBe(false);
    expect(isKeyedAccountPath('/api/quote/BTC-USDT', 'GET')).toBe(false);
    expect(isKeyedAccountPath('/api/trading/status', 'GET')).toBe(false);
  });
});

describe('auth off + wildcard CORS (the insecure default) fails closed', () => {
  let app: FastifyInstance;
  let cancelOrder: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    const provider = createProvider('mock');
    cancelOrder = vi.fn(provider.cancelOrder!.bind(provider));
    Object.assign(provider, { cancelOrder });
    // No corsOrigin override: config resolves the unset env to '*', exactly
    // the shipped default posture.
    app = await buildApp(provider, { auth: { enabled: false } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses keyed account reads with an honest 403 naming both switches', async () => {
    for (const url of [
      '/api/balances',
      '/api/orders',
      '/api/positions',
      '/api/fills',
      '/api/account/events',
      '/api/account/equity',
      '/api/orders/demo-1?symbol=BTC/USDT',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(403);
      const body = res.json();
      expect(body.error, url).toBe('Forbidden');
      expect(body.statusCode, url).toBe(403);
      expect(body.message, url).toMatch(/MIDAS_AUTH_ENABLED/);
      expect(body.message, url).toMatch(/MIDAS_CORS_ORIGIN/);
    }
  });

  it('refuses cancel-only DELETE before any provider call', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/orders/demo-1?symbol=BTC/USDT' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('Forbidden');
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('keeps POST /api/orders on the 503 TradingSafetyHold contract', async () => {
    const place = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { symbol: 'BTC/USDT', side: 'buy', type: 'limit', amount: 0.01, price: 1 },
    });
    expect(place.statusCode).toBe(503);
    expect(place.json()).toMatchObject({ error: 'TradingSafetyHold' });
  });

  it('leaves public market-data and status routes alone', async () => {
    for (const url of [
      '/api/health',
      '/api/quote/BTC-USDT',
      '/api/quotes?symbols=BTC-USDT',
      '/api/trading/status',
      '/api/data/status',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
  });
});

describe('auth off + pinned CORS (the accepted self-host posture) keeps working', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'), {
      auth: { enabled: false },
      corsOrigin: PINNED_ORIGIN,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves keyed account reads', async () => {
    for (const url of ['/api/balances', '/api/orders', '/api/positions', '/api/fills']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('keeps cancel-only DELETE live and ownership-gated', async () => {
    const cancel = await app.inject({ method: 'DELETE', url: '/api/orders/demo-1?symbol=BTC/USDT' });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ id: 'demo-1', status: 'canceled' });
    const unknown = await app.inject({ method: 'DELETE', url: '/api/orders/fake-id?symbol=BTC/USDT' });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('auth on is unaffected (the auth guard governs)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'), {
      // Wildcard CORS with auth ON is a supported posture — the keyed guard
      // must stand down and let the auth guard answer.
      auth: { enabled: true, allowSignup: false, secret: 'test-secret' },
      userRepo: new UserRepo(),
      corsOrigin: '*',
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 Unauthorized (not the keyed-account 403) when logged out', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/balances' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized', statusCode: 401 });
  });

  it('serves keyed account reads to an authenticated user', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'keyed-reader', password: 'hunter2' },
    });
    expect(signup.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${signup.json().token}` };
    const res = await app.inject({ method: 'GET', url: '/api/orders', headers });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().orders)).toBe(true);
  });
});
