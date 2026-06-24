import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseAlertInput } from '@midas/shared';
import type { DataProvider } from './providers';
import { buildApp } from './app';
import { AlertRepo } from './alerts/repo';
import { UserRepo } from './auth/users';
import { evaluateOnce } from './alerts/engine';

/** Minimal provider whose quotes always report a fixed price. */
function stubProvider(price: number): DataProvider {
  return {
    name: 'stub',
    live: false,
    getQuote: async (symbol: string) => ({ symbol, price, changePercent: 0 }),
    getQuotes: async (symbols: string[]) =>
      symbols.map((symbol) => ({ symbol, price, changePercent: 0 })),
    getHistory: async () => {
      throw new Error('not implemented');
    },
    getOrderBook: async () => {
      throw new Error('not implemented');
    },
    getExchangeQuotes: async () => [],
    getDerivatives: async () => {
      throw new Error('not implemented');
    },
    screen: async () => [],
    search: async () => [],
    getNews: async () => [],
  } as unknown as DataProvider;
}

describe('parseAlertInput', () => {
  it('accepts a valid body and upper-cases the symbol', () => {
    const input = parseAlertInput({ symbol: 'btc/usdt', metric: 'price', op: 'above', value: 70000, repeat: true });
    expect(input).toMatchObject({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: 70000, repeat: true });
  });

  it('rejects bad metric / op / value / symbol', () => {
    expect(parseAlertInput({ symbol: 'BTC/USDT', metric: 'x', op: 'above', value: 1 })).toBeNull();
    expect(parseAlertInput({ symbol: 'BTC/USDT', metric: 'price', op: 'x', value: 1 })).toBeNull();
    expect(parseAlertInput({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: 'nope' })).toBeNull();
    expect(parseAlertInput({ symbol: '', metric: 'price', op: 'above', value: 1 })).toBeNull();
    expect(parseAlertInput(null)).toBeNull();
  });
});

describe('evaluateOnce', () => {
  it('fires a price alert only once it crosses the threshold', async () => {
    const repo = new AlertRepo();
    repo.create({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: 70000, repeat: false }, 1);

    let fired = await evaluateOnce(repo, stubProvider(69000), 2);
    expect(fired).toHaveLength(0);
    expect(repo.listFor()[0].status).toBe('armed');

    fired = await evaluateOnce(repo, stubProvider(71000), 3);
    expect(fired).toHaveLength(1);
    expect(repo.listFor()[0].status).toBe('triggered');
    expect(repo.logFor()).toHaveLength(1);
  });

  it('does nothing when no alerts are enabled', async () => {
    const repo = new AlertRepo();
    expect(await evaluateOnce(repo, stubProvider(1), 1)).toEqual([]);
  });
});

describe('alerts API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(70000), { alertRepo: new AlertRepo() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, lists, patches and deletes alerts', async () => {
    let res = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      payload: { symbol: 'eth/usdt', metric: 'price', op: 'below', value: 3000, repeat: false },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.symbol).toBe('ETH/USDT');
    expect(created.status).toBe('armed');

    res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.json()).toHaveLength(1);

    res = await app.inject({ method: 'PATCH', url: `/api/alerts/${created.id}`, payload: { enabled: false } });
    expect(res.json().enabled).toBe(false);

    res = await app.inject({ method: 'DELETE', url: `/api/alerts/${created.id}` });
    expect(res.statusCode).toBe(200);

    res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.json()).toHaveLength(0);
  });

  it('rejects an invalid alert with 400 and 404s an unknown id', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      payload: { symbol: 'BTC/USDT', metric: 'nonsense', op: 'above', value: 1 },
    });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({ method: 'DELETE', url: '/api/alerts/nope' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('per-user alert isolation', () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;

  const hdr = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(70000), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      alertRepo: new AlertRepo(),
    });
    await app.ready();
    const signup = async (username: string) =>
      (
        await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username, password: 'pw1234' } })
      ).json().token as string;
    tokenA = await signup('alice');
    tokenB = await signup('bob');
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps each user’s alerts private', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: hdr(tokenA),
        payload: { symbol: 'BTC/USDT', metric: 'price', op: 'above', value: 1, repeat: false },
      })
    ).json();

    const aliceList = await app.inject({ method: 'GET', url: '/api/alerts', headers: hdr(tokenA) });
    expect(aliceList.json()).toHaveLength(1);

    const bobList = await app.inject({ method: 'GET', url: '/api/alerts', headers: hdr(tokenB) });
    expect(bobList.json()).toHaveLength(0);

    // Bob cannot delete Alice's alert…
    const cross = await app.inject({ method: 'DELETE', url: `/api/alerts/${created.id}`, headers: hdr(tokenB) });
    expect(cross.statusCode).toBe(404);

    // …but Alice can.
    const own = await app.inject({ method: 'DELETE', url: `/api/alerts/${created.id}`, headers: hdr(tokenA) });
    expect(own.statusCode).toBe(200);
  });
});
