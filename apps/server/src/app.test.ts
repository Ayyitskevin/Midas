import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent'; // keep test output clean
  app = await buildApp(createProvider('mock'));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const sym = (s: string) => encodeURIComponent(s);

describe('GET /api/health', () => {
  it('reports the active provider and a version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('mock');
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
  });
});

describe('GET /api/quote/:symbol', () => {
  it('returns a quote with a numeric price', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/quote/${sym('BTC/USDT')}` });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.symbol).toBe('BTC/USDT');
    expect(typeof q.price).toBe('number');
  });
});

describe('GET /api/quotes', () => {
  it('returns one quote per requested symbol', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/quotes?symbols=${sym('BTC/USDT,ETH/USDT')}` });
    expect(res.statusCode).toBe(200);
    const arr = res.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(2);
  });
});

describe('GET /api/history/:symbol', () => {
  it('returns OHLCV candles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/history/${sym('BTC/USDT')}?interval=1d&range=1mo`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.candles)).toBe(true);
    expect(body.candles.length).toBeGreaterThan(0);
    for (const k of ['time', 'open', 'high', 'low', 'close', 'volume']) {
      expect(typeof body.candles[0][k]).toBe('number');
    }
  });
});

describe('GET /api/derivatives/:symbol', () => {
  it('includes a fundingRate field', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/derivatives/${sym('BTC/USDT')}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('fundingRate');
  });
});

describe('GET /api/funding', () => {
  it('returns a board of funding rows with the limit honoured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows[0]).toHaveProperty('symbol');
    expect(rows[0]).toHaveProperty('fundingRate');
    expect(rows[0]).toHaveProperty('openInterestValue');
  });
});

describe('GET /api/liquidations', () => {
  it('returns a merged, newest-first feed with notional values', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const events = res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty('symbol');
    expect(events[0]).toHaveProperty('value');
    expect(['buy', 'sell']).toContain(events[0].side);
    // newest-first
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].timestamp).toBeGreaterThanOrEqual(events[i].timestamp);
    }
  });
});

describe('unknown route', () => {
  it('returns the 404 ApiError shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('NotFound');
    expect(body.statusCode).toBe(404);
  });
});
