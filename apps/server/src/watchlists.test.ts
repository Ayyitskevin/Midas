import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DataProvider } from './providers';
import { buildApp } from './app';
import { WatchlistRepo } from './watchlists/repo';
import { UserRepo } from './auth/users';

function stubProvider(): DataProvider {
  return {
    name: 'stub',
    live: false,
    getQuote: async (symbol: string) => ({ symbol, price: 1, changePercent: 0 }),
    getQuotes: async () => [],
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

describe('watchlists API (auth off)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(), { watchlistRepo: new WatchlistRepo() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('round-trips a watchlist snapshot and 400s a non-object body', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/watchlists' });
    expect(res.json().snapshot).toBeNull();

    const blob = { lists: [{ id: 'default', name: 'Watchlist' }], activeId: 'default', symbols: ['BTC/USDT'], saved: {} };
    const put = await app.inject({ method: 'PUT', url: '/api/watchlists', payload: blob });
    expect(put.statusCode).toBe(200);

    res = await app.inject({ method: 'GET', url: '/api/watchlists' });
    expect(res.json().snapshot.blob).toEqual(blob);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/watchlists',
      payload: JSON.stringify('nope'),
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('per-user watchlist isolation', () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;
  const hdr = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      watchlistRepo: new WatchlistRepo(),
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

  it('requires auth and keeps each user’s lists private', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/watchlists' })).statusCode).toBe(401);

    await app.inject({ method: 'PUT', url: '/api/watchlists', headers: hdr(tokenA), payload: { symbols: ['BTC/USDT'] } });
    expect((await app.inject({ method: 'GET', url: '/api/watchlists', headers: hdr(tokenB) })).json().snapshot).toBeNull();

    const a = await app.inject({ method: 'GET', url: '/api/watchlists', headers: hdr(tokenA) });
    expect(a.json().snapshot.blob.symbols).toEqual(['BTC/USDT']);
  });
});
