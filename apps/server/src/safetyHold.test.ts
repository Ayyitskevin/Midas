/**
 * The execution posture, canonically: POST /api/orders must fail closed with
 * 503 TradingSafetyHold, while DELETE /api/orders/:id is live but
 * ownership-gated (cancel-only), against the real `buildApp` entry point.
 * This is the flagship proof of the fail-closed placement invariant — kept in
 * its own file so it cannot disappear with a themed regression suite (the
 * same assertions also live in depWave.regression.test.ts, which may be
 * deleted with its wave).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';

describe('execution posture (fail-closed placement, cancel-only)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    // Cancel-only is exercised from the accepted no-auth posture: a PINNED
    // CORS origin. With the default wildcard origin, keyed account surfaces
    // (including this DELETE) fail closed — proven in keyedAccountGuard.test.ts.
    app = await buildApp(createProvider('mock'), { corsOrigin: 'http://localhost:8080' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects order placement with 503 TradingSafetyHold', async () => {
    const place = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        symbol: 'BTC/USDT',
        side: 'buy',
        type: 'limit',
        amount: 0.01,
        price: 1,
      },
    });
    expect(place.statusCode).toBe(503);
    expect(place.json()).toMatchObject({ error: 'TradingSafetyHold' });
  });

  it('reports the cancel-only posture', async () => {
    const status = (await app.inject({ method: 'GET', url: '/api/trading/status' })).json();
    expect(status).toMatchObject({ enabled: false, cancelEnabled: true, mode: 'cancel-only' });
  });

  it('cancels an order that sits in the caller\'s own open-orders list', async () => {
    // The mock provider's synthetic book always holds demo-1..3.
    const cancel = await app.inject({
      method: 'DELETE',
      url: '/api/orders/demo-1?symbol=BTC/USDT',
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ id: 'demo-1', symbol: 'BTC/USDT', status: 'canceled' });
    // …and the canceled order leaves the caller's open-orders list.
    const open = await app.inject({ method: 'GET', url: '/api/orders' });
    expect((open.json().orders as Array<{ id: string }>).map((o) => o.id)).not.toContain('demo-1');
  });

  it('answers 404 — never a blind cancel — for an id not in the caller\'s open orders', async () => {
    const cancel = await app.inject({
      method: 'DELETE',
      url: '/api/orders/fake-id?symbol=BTC/USDT',
    });
    expect(cancel.statusCode).toBe(404);
    expect(cancel.json().message).toMatch(/not among this account's open orders/);
  });

  it('answers an honest 404 when the order is no longer open', async () => {
    const first = await app.inject({ method: 'DELETE', url: '/api/orders/demo-2?symbol=ETH/USDT' });
    expect(first.statusCode).toBe(200);
    // Second cancel: no longer in the open-orders list → ownership 404 at the
    // route. The provider-layer 409 ("already filled or canceled") is proven
    // in mock.test.ts / ccxt.test.ts.
    const second = await app.inject({ method: 'DELETE', url: '/api/orders/demo-2?symbol=ETH/USDT' });
    expect(second.statusCode).toBe(404);
  });
});
