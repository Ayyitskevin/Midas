import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DataProvider } from './providers';
import { buildApp } from './app';
import { PortfolioRepo } from './portfolio/repo';
import { UserRepo } from './auth/users';

/** Minimal provider — portfolio routes never touch it. */
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

describe('PortfolioRepo', () => {
  it('returns null before anything is stored, then the stamped blob', () => {
    const repo = new PortfolioRepo();
    expect(repo.get()).toBeNull();
    const saved = repo.set(undefined, { realized: 42, positions: [], transactions: [] }, 1000);
    expect(saved.updatedAt).toBe(1000);
    expect(repo.get()).toEqual({ blob: { realized: 42, positions: [], transactions: [] }, updatedAt: 1000 });
  });

  it('scopes snapshots per user and keeps `@local` separate', () => {
    const repo = new PortfolioRepo();
    repo.set('alice', { realized: 1 }, 1);
    repo.set('bob', { realized: 2 }, 2);
    repo.set(undefined, { realized: 3 }, 3);
    expect(repo.get('alice')?.blob).toEqual({ realized: 1 });
    expect(repo.get('bob')?.blob).toEqual({ realized: 2 });
    expect(repo.get()?.blob).toEqual({ realized: 3 });
  });
});

describe('portfolio API (auth off)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(), { portfolioRepo: new PortfolioRepo() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('round-trips a portfolio snapshot through PUT then GET', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/portfolio' });
    expect(res.statusCode).toBe(200);
    expect(res.json().snapshot).toBeNull();

    const book = {
      realized: 150.5,
      positions: [{ id: 'p1', symbol: 'BTC/USDT', quantity: 2, entryPrice: 100, openedAt: 1 }],
      transactions: [{ id: 't1', symbol: 'BTC/USDT', quantity: 2, price: 100, realized: 0, at: 1 }],
    };
    const put = await app.inject({ method: 'PUT', url: '/api/portfolio', payload: book });
    expect(put.statusCode).toBe(200);
    expect(put.json().ok).toBe(true);

    res = await app.inject({ method: 'GET', url: '/api/portfolio' });
    expect(res.json().snapshot.blob).toEqual(book);
  });

  it('rejects a non-object body with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/portfolio',
      payload: JSON.stringify('nope'),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('per-user portfolio isolation', () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;

  const hdr = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      portfolioRepo: new PortfolioRepo(),
    });
    await app.ready();
    const signup = async (username: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/signup',
          payload: { username, password: 'pw1234' },
        })
      ).json().token as string;
    tokenA = await signup('alice');
    tokenB = await signup('bob');
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires auth and keeps each user’s book private', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/portfolio' });
    expect(anon.statusCode).toBe(401);

    await app.inject({
      method: 'PUT',
      url: '/api/portfolio',
      headers: hdr(tokenA),
      payload: { realized: 11, positions: [], transactions: [] },
    });

    const bobEmpty = await app.inject({ method: 'GET', url: '/api/portfolio', headers: hdr(tokenB) });
    expect(bobEmpty.json().snapshot).toBeNull();

    await app.inject({
      method: 'PUT',
      url: '/api/portfolio',
      headers: hdr(tokenB),
      payload: { realized: 22, positions: [], transactions: [] },
    });

    const aliceGet = await app.inject({ method: 'GET', url: '/api/portfolio', headers: hdr(tokenA) });
    expect(aliceGet.json().snapshot.blob.realized).toBe(11);

    const bobGet = await app.inject({ method: 'GET', url: '/api/portfolio', headers: hdr(tokenB) });
    expect(bobGet.json().snapshot.blob.realized).toBe(22);
  });
});
