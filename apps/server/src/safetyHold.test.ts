/**
 * The execution safety hold, canonically: POST /api/orders and
 * DELETE /api/orders/:id must fail closed with 503 TradingSafetyHold against
 * the real `buildApp` entry point. This is the flagship proof of the
 * fail-closed invariant — kept in its own file so it cannot disappear with a
 * themed regression suite (the same assertions also live in
 * depWave.regression.test.ts, which may be deleted with its wave).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';

describe('execution safety hold (fail-closed order writes)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'));
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

  it('rejects order cancellation with 503 TradingSafetyHold', async () => {
    const cancel = await app.inject({
      method: 'DELETE',
      url: '/api/orders/fake-id',
    });
    expect(cancel.statusCode).toBe(503);
    expect(cancel.json()).toMatchObject({ error: 'TradingSafetyHold' });
  });
});
