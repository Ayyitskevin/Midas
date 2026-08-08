/**
 * Regression coverage for the safe patch/minor dependency wave
 * (fastify, @fastify/websocket, ws, and related stack).
 *
 * Drives the real `buildApp` entry point — not a reimplementation of
 * CORS/websocket/order routes. Fails if a semver-compatible bump breaks
 * registration, mock honesty labels, or the execution safety hold.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';
import { MAX_STREAM_FRAME_BYTES } from './streaming';

const sym = (s: string) => encodeURIComponent(s);

describe('dependency wave regressions (fastify / websocket / mock honesty)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    // Pinned CORS = the accepted no-auth posture, so the cancel-only DELETE
    // assertions below stay live (wildcard CORS fails closed — see
    // keyedAccountGuard.test.ts).
    app = await buildApp(createProvider('mock'), { corsOrigin: 'http://localhost:8080' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves health through the upgraded Fastify stack', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status?: string;
      provider?: string;
      live?: boolean;
      streamLive?: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.provider).toBe('mock');
    // mock must never advertise a live market feed
    expect(body.live).toBe(false);
    expect(body.streamLive).toBe(false);
  });

  it('applies CORS headers via @fastify/cors on API responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://terminal.example' },
    });
    expect(res.statusCode).toBe(200);
    // Default MIDAS_CORS_ORIGIN is `*`; the plugin must still emit ACAO.
    expect(res.headers['access-control-allow-origin']).toBeTruthy();
  });

  it('keeps the WebSocket maxPayload cap after @fastify/websocket / ws bumps', () => {
    const wss = (app as unknown as { websocketServer?: { options?: { maxPayload?: number } } })
      .websocketServer;
    expect(wss).toBeDefined();
    expect(wss?.options?.maxPayload).toBe(MAX_STREAM_FRAME_BYTES);
  });

  it('labels mock on-chain data as synthetic (data-honesty contract)', async () => {
    const quote = await app.inject({ method: 'GET', url: `/api/quote/${sym('BTC/USDT')}` });
    expect(quote.statusCode).toBe(200);
    expect(quote.json()).toMatchObject({ symbol: 'BTC/USDT' });
    expect(typeof quote.json().price).toBe('number');

    const onchain = await app.inject({ method: 'GET', url: `/api/onchain/${sym('ETH/USDT')}` });
    expect(onchain.statusCode).toBe(200);
    expect(onchain.json().provenance).toBe('synthetic');
  });

  it('keeps order placement fail-closed under TradingSafetyHold', async () => {
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

  it('keeps cancellation live but ownership-gated (cancel-only posture)', async () => {
    // An id that is not in the caller's own open-orders list → 404, never a
    // blind cancel call.
    const unknown = await app.inject({
      method: 'DELETE',
      url: '/api/orders/fake-id?symbol=BTC/USDT',
    });
    expect(unknown.statusCode).toBe(404);

    // A resting order from the caller's own list cancels for real (mock book).
    const cancel = await app.inject({
      method: 'DELETE',
      url: '/api/orders/demo-3?symbol=SOL/USDT',
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ id: 'demo-3', status: 'canceled' });
  });
});
