import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseAlertInput, ACCOUNT_SYMBOL, type AlertTrigger } from '@midas/shared';
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

  it('rejects an over-long symbol or note (persisted-store DoS guard)', () => {
    expect(parseAlertInput({ symbol: 'A'.repeat(40), metric: 'price', op: 'above', value: 1 })).toBeNull();
    expect(
      parseAlertInput({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: 1, note: 'x'.repeat(300) }),
    ).toBeNull();
    // A normal-length note still passes through unchanged.
    expect(
      parseAlertInput({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: 1, note: 'watch me' }),
    ).toMatchObject({ note: 'watch me' });
  });

  it('rejects null/empty/array/boolean/blank-string values (the Number(null) === 0 footgun)', () => {
    // Every one of these coerces to 0 (or 1) via a bare Number(...) and would
    // otherwise pass the isFinite gate as a bogus threshold-0 alert.
    for (const value of [null, undefined, '', '   ', [], {}, false, true]) {
      expect(parseAlertInput({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value })).toBeNull();
    }
    // The real-world path: JSON.stringify({ value: NaN }) === '{"value":null}'.
    const overWire = JSON.parse(JSON.stringify({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: NaN }));
    expect(parseAlertInput(overWire)).toBeNull();
  });

  it('accepts a numeric string threshold but not a blank one', () => {
    expect(
      parseAlertInput({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: '70000' }),
    ).toMatchObject({ value: 70000 });
    expect(parseAlertInput({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: '  ' })).toBeNull();
  });

  it('forces equity alerts onto the ACCOUNT pseudo-symbol so they can actually fire', () => {
    // Equity is only ever published under ACCOUNT_SYMBOL, so an equity alert on
    // a market pair would arm but never fire — normalize the symbol.
    expect(
      parseAlertInput({ symbol: 'BTC/USDT', metric: 'equity', op: 'below', value: 5000 }),
    ).toMatchObject({ symbol: ACCOUNT_SYMBOL, metric: 'equity' });
    // …and an equity alert needs no symbol at all.
    expect(parseAlertInput({ metric: 'equity', op: 'below', value: 5000 })).toMatchObject({
      symbol: ACCOUNT_SYMBOL,
    });
    // upnl stays per-position (keyed by the position's own symbol).
    expect(
      parseAlertInput({ symbol: 'BTC/USDT', metric: 'upnl', op: 'below', value: -100 }),
    ).toMatchObject({ symbol: 'BTC/USDT', metric: 'upnl' });
  });
});

describe('alert store caps (unbounded-persistence guard)', () => {
  it('refuses to create past the per-owner alert cap with 429', async () => {
    const repo = new AlertRepo();
    for (let i = 0; i < 200; i++) {
      repo.create({ symbol: 'BTC/USDT', metric: 'price', op: 'above', value: i + 1, repeat: false }, i);
    }
    expect(repo.atCapacityFor()).toBe(true);

    const app = await buildApp(stubProvider(70000), { alertRepo: repo });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/alerts',
        payload: { symbol: 'ETH/USDT', metric: 'price', op: 'above', value: 1, repeat: false },
      });
      expect(res.statusCode).toBe(429);
    } finally {
      await app.close();
    }
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

  it('rejects account-metric (equity/upnl) alerts under multi-user auth', async () => {
    // These can never fire per-user in the current engine, so the route refuses
    // to persist a dead 'armed' alert rather than mislead the user.
    for (const metric of ['equity', 'upnl'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: hdr(tokenA),
        payload: { symbol: 'ACCOUNT', metric, op: 'below', value: 1000, repeat: false },
      });
      expect(res.statusCode).toBe(400);
    }
    // A normal price alert from the same authed user still works.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/alerts',
      headers: hdr(tokenA),
      payload: { symbol: 'ETH/USDT', metric: 'price', op: 'above', value: 1, repeat: false },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe('trigger log is bounded per owner (multi-user fairness)', () => {
  const mkTrig = (id: string, userId: string): AlertTrigger => ({
    id,
    alertId: 'a',
    userId,
    symbol: 'BTC/USDT',
    metric: 'price',
    op: 'above',
    value: 1,
    actual: 2,
    at: 1,
  });

  it('one busy user cannot evict another user’s trigger history', () => {
    const repo = new AlertRepo();
    repo.commit([], [mkTrig('b1', 'usr_bob')]);
    expect(repo.logFor('usr_bob')).toHaveLength(1);

    // Alice floods 600 fires — past the 500 per-owner cap.
    const flood = Array.from({ length: 600 }, (_, i) => mkTrig(`a${i}`, 'usr_alice'));
    repo.commit([], flood);

    // Her own log is capped at 500; Bob's single trigger survives (with a single
    // global cap it would have been evicted from the newest-500 window).
    expect(repo.logFor('usr_alice')).toHaveLength(500);
    expect(repo.logFor('usr_bob')).toHaveLength(1);
  });
});
