import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDataReceipt } from '@midas/shared';
import type {
  OpenOrder,
  OrderRequest,
  PlacedOrder,
  ProviderCapabilityManifest,
} from '@midas/shared';
import {
  computeTradingStatus,
  createScopedDailyLedgers,
  EXECUTION_SAFETY_HOLD_REASON,
  type TradingConfig,
} from '../trading';
import { KeyRepo, type UserExchangeKeys } from './repo';
import { createUserLoops, userEquityFileName } from './loops';
import { buildApp } from '../app';
import { config } from '../config';
import { createProvider, ProviderError, type DataProvider } from '../providers';
import { buildProviderCapabilities } from '../providers/receipts';
import type { AccountWatchHandle } from '../accountWatch';

const KMS = 'test-kms-secret';

// ---------------------------------------------------------------------------
// Pure gates
// ---------------------------------------------------------------------------

const cfgOn: TradingConfig = {
  enabled: true,
  allowNoAuth: false,
  maxOrderUsd: 1000,
  maxDailyUsd: 5000,
  authEnabled: true,
  corsOrigin: 'https://midas.example',
};
const liveCtx = { providerName: 'ccxt:kraken', providerLive: true, hasKeys: true };

describe('per-user trading gates (pure)', () => {
  it('enables trading for a usable, trade-marked user key when every operator gate passes', () => {
    const s = computeTradingStatus(cfgOn, liveCtx, 0, { canTrade: true, usable: true });
    expect(s.enabled).toBe(true);
    expect(s.source).toBe('ccxt:kraken');
  });

  it('refuses a key the user did not mark trade-permissioned', () => {
    const s = computeTradingStatus(cfgOn, liveCtx, 0, { canTrade: false, usable: true });
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/not marked trade-permissioned/);
  });

  it('refuses unusable stored keys — never falls back to the operator account', () => {
    const s = computeTradingStatus(cfgOn, liveCtx, 0, { canTrade: true, usable: false });
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/could not be used/);
  });

  it("the operator's master switch still kills user-keyed trading", () => {
    const s = computeTradingStatus({ ...cfgOn, enabled: false }, liveCtx, 0, { canTrade: true, usable: true });
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/MIDAS_TRADING_ENABLED/);
  });

  it('does not ask user-keyed traders for operator env keys', () => {
    const s = computeTradingStatus(cfgOn, { ...liveCtx, hasKeys: true }, 0, { canTrade: false, usable: true });
    expect(s.reason).not.toMatch(/MIDAS_CCXT_API_KEY/);
  });
});

describe('scoped daily ledgers', () => {
  it('tracks each identity separately and rolls per UTC day', () => {
    const l = createScopedDailyLedgers();
    const day1 = Date.UTC(2026, 6, 1, 12);
    l.add('alice', 900, day1);
    l.add('@local', 50, day1);
    expect(l.used('alice', day1)).toBe(900);
    expect(l.used('bob', day1)).toBe(0);
    expect(l.used('@local', day1)).toBe(50);
    const day2 = Date.UTC(2026, 6, 2, 0, 1);
    expect(l.used('alice', day2)).toBe(0); // fresh UTC day
  });
});

// ---------------------------------------------------------------------------
// Per-user loop manager
// ---------------------------------------------------------------------------

interface StubOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number | null;
  amount: number;
  filled: number;
  status: string;
}

const makeAccountStub = (name: string) => {
  let orders: StubOrder[] = [];
  return {
    name,
    live: true,
    setOrders: (next: StubOrder[]) => {
      orders = next;
    },
    getOpenOrders: async () => ({ source: name, provenance: 'live' as const, note: null, orders, asOf: 0 }),
    getBalances: async () => ({ source: name, provenance: 'live' as const, note: null, balances: [], totalValueUsd: 123, asOf: 0 }),
    getPositions: async () => ({ source: name, provenance: 'live' as const, note: null, positions: [], totalUnrealizedPnlUsd: null, asOf: 0 }),
  };
};

describe('per-user loops', () => {
  const keys = (exchange: string): UserExchangeKeys => ({ exchange, apiKey: `${exchange}-key`, secret: 's', canTrade: false });

  it('starts a loop set per keyed user, isolated per user, and drops on delete', async () => {
    const repo = new KeyRepo(KMS);
    repo.set('alice', keys('binance'), 0);
    repo.set('bob', keys('kraken'), 0);
    const stubs = new Map([
      ['alice', makeAccountStub('ccxt:binance')],
      ['bob', makeAccountStub('ccxt:kraken')],
    ]);
    const loops = createUserLoops({
      repo,
      pool: { userFor: (id) => (id && stubs.get(id) ? (stubs.get(id) as unknown as DataProvider) : null) },
      watchMs: 3600_000, // real timer far away; tests drive tick() directly
      equityMs: 0,
    });
    loops.ensure('alice');
    loops.ensure('bob');
    expect(loops.size()).toBe(2);

    // Baseline pass, then a fill on alice's account only.
    const aliceWatch = loops.watcherFor('alice') as AccountWatchHandle;
    const bobWatch = loops.watcherFor('bob') as AccountWatchHandle;
    stubs.get('alice')!.setOrders([{ id: '1', symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1, filled: 0, status: 'open' }]);
    await aliceWatch.tick();
    await bobWatch.tick();
    stubs.get('alice')!.setOrders([{ id: '1', symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1, filled: 0.5, status: 'open' }]);
    await aliceWatch.tick();
    await bobWatch.tick();
    expect(aliceWatch.eventsSince(0).map((e) => e.kind)).toEqual(['fill']);
    expect(bobWatch.eventsSince(0)).toEqual([]);

    loops.drop('alice');
    expect(loops.watcherFor('alice')).toBeNull();
    expect(loops.size()).toBe(1);
    loops.stopAll();
  });

  it('hands fill batches to the matching user only', async () => {
    const repo = new KeyRepo(KMS);
    repo.set('alice', keys('binance'), 0);
    repo.set('bob', keys('kraken'), 0);
    const stubs = new Map([
      ['alice', makeAccountStub('ccxt:binance')],
      ['bob', makeAccountStub('ccxt:kraken')],
    ]);
    const delivered: Array<{ userId: string; kinds: string[] }> = [];
    const loops = createUserLoops({
      repo,
      pool: { userFor: (id) => (id && stubs.get(id) ? (stubs.get(id) as unknown as DataProvider) : null) },
      watchMs: 3600_000,
      equityMs: 0,
      onFillBatch: (userId, events) =>
        delivered.push({ userId, kinds: events.map((event) => event.kind) }),
    });
    loops.ensure('alice');
    loops.ensure('bob');
    const alice = loops.watcherFor('alice')!;
    const bob = loops.watcherFor('bob')!;
    stubs.get('alice')!.setOrders([
      { id: 'a', symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1, filled: 0, status: 'open' },
    ]);
    stubs.get('bob')!.setOrders([
      { id: 'b', symbol: 'ETH/USDT', side: 'sell', price: 50, amount: 2, filled: 0, status: 'open' },
    ]);
    await alice.tick();
    await bob.tick();

    stubs.get('alice')!.setOrders([
      { id: 'a', symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1, filled: 0.5, status: 'open' },
    ]);
    // Bob receives only a new non-execution order; it must not notify anyone.
    stubs.get('bob')!.setOrders([
      { id: 'b', symbol: 'ETH/USDT', side: 'sell', price: 50, amount: 2, filled: 0, status: 'open' },
      { id: 'b2', symbol: 'SOL/USDT', side: 'buy', price: 10, amount: 1, filled: 0, status: 'open' },
    ]);
    await alice.tick();
    await bob.tick();

    expect(delivered).toEqual([{ userId: 'alice', kinds: ['fill'] }]);
    loops.stopAll();
  });

  it('rebuilds on ensure (key change) and never runs loops without a usable user provider', () => {
    const repo = new KeyRepo(KMS);
    repo.set('alice', keys('binance'), 0);
    let usable = true;
    const loops = createUserLoops({
      repo,
      pool: { userFor: () => (usable ? (makeAccountStub('ccxt:binance') as unknown as DataProvider) : null) },
      watchMs: 3600_000,
      equityMs: 0,
    });
    loops.ensure('alice');
    const first = loops.watcherFor('alice');
    loops.ensure('alice'); // key re-saved → fresh set
    expect(loops.watcherFor('alice')).not.toBe(first);

    usable = false; // e.g. wrong KMS after a secret rotation
    loops.ensure('alice');
    expect(loops.watcherFor('alice')).toBeNull(); // no loops against the base provider, ever
    expect(loops.size()).toBe(0);

    repo.remove('alice');
    usable = true;
    loops.ensure('alice');
    expect(loops.size()).toBe(0); // no keys → no loops
    loops.stopAll();
  });

  it('enforces the keyed-user cap with an honest refusal hook', () => {
    const repo = new KeyRepo(KMS);
    repo.set('u1', keys('binance'), 0);
    repo.set('u2', keys('kraken'), 0);
    const refused: string[] = [];
    const loops = createUserLoops({
      repo,
      pool: { userFor: () => makeAccountStub('x') as unknown as DataProvider },
      watchMs: 3600_000,
      equityMs: 0,
      maxUsers: 1,
      onRefused: (id) => refused.push(id),
    });
    loops.ensure('u1');
    loops.ensure('u2');
    expect(loops.size()).toBe(1);
    expect(refused).toEqual(['u2']);
    loops.stopAll();
  });

  it('user equity filenames are filesystem-safe', () => {
    expect(userEquityFileName('u_abc-123')).toBe('equity-u_abc-123.json');
    expect(userEquityFileName('../../etc/passwd')).toBe('equity-______etc_passwd.json');
  });
});

// ---------------------------------------------------------------------------
// Route-level: execution posture (placement held, cancel-only live)
// ---------------------------------------------------------------------------

interface TradeStub {
  name: string;
  live: boolean;
  capabilities: ProviderCapabilityManifest;
  placeOrder: ReturnType<typeof vi.fn>;
  cancelOrder: ReturnType<typeof vi.fn>;
  getQuote: ReturnType<typeof vi.fn>;
  getOpenOrders: ReturnType<typeof vi.fn>;
  setOrders: (orders: OpenOrder[]) => void;
}

const makeOpenOrder = (id: string, symbol = 'BTC/USDT'): OpenOrder => ({
  id,
  symbol,
  side: 'buy',
  type: 'limit',
  price: 100,
  amount: 1,
  filled: 0,
  remaining: 1,
  value: 100,
  timestamp: 0,
  status: 'open',
});

const makeTradeStub = (name: string, tag: string): TradeStub => {
  let n = 0;
  let orders: OpenOrder[] = [];
  const capabilities = buildProviderCapabilities({
    providerId: name,
    providerVersion: 'test-1.0',
    source: name,
    capabilities: {
      'account-orders': {
        method: 'getOpenOrders',
        support: 'supported',
        auth: 'credentials-required',
        mode: 'live',
        venue: 'kraken',
        coverage: 'injected caller account',
        expectedCadenceMs: 60_000,
        maxAgeMs: 120_000,
        cacheTtlMs: null,
        methodology: null,
        caveats: ['Route-test provider.'],
      },
    },
  });
  return {
    name,
    live: true,
    capabilities,
    placeOrder: vi.fn(async (req: OrderRequest): Promise<PlacedOrder> => {
      n += 1;
      return {
        id: `${tag}-ord-${n}`,
        clientOrderId: req.clientOrderId ?? null,
        symbol: req.symbol,
        side: req.side,
        type: req.type,
        amount: req.amount,
        price: req.price ?? null,
        status: 'open',
        filled: 0,
        timestamp: 0,
      } as PlacedOrder;
    }),
    cancelOrder: vi.fn(async (id: string, symbol: string) => ({ id, symbol, status: 'canceled' })),
    getQuote: vi.fn(async () => ({ price: 100 })),
    getOpenOrders: vi.fn(async () => {
      const asOf = Date.now();
      return {
        source: name,
        provenance: 'live',
        note: null,
        orders,
        asOf,
        receipt: createDataReceipt({
          providerId: capabilities.providerId,
          providerVersion: capabilities.providerVersion,
          source: capabilities.source,
          datasetFamily: 'account-orders',
          coverage: 'injected caller account',
          provenance: 'live',
          sourceAsOf: null,
          observedAt: asOf,
          expectedCadenceMs: 60_000,
          maxAgeMs: 120_000,
          units: {},
          limitations: ['Route-test provider.'],
        }, asOf),
      };
    }),
    setOrders: (next: OpenOrder[]) => {
      orders = next;
    },
  };
};

describe('execution posture routes (placement hold + cancel-only)', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  let tokenC = '';
  const stubs = new Map<string, TradeStub>(); // apiKey → stub
  const operatorPlace = vi.fn();
  const operatorCancel = vi.fn();
  const saved = {
    tradingEnabled: config.tradingEnabled,
    authEnabled: config.authEnabled,
    maxOrderUsd: config.maxOrderUsd,
    maxDailyUsd: config.maxDailyUsd,
  };

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    // Deliberately enable every legacy gate. The safety hold must still win.
    Object.assign(config, { tradingEnabled: true, authEnabled: true, maxOrderUsd: 0, maxDailyUsd: 0 });
    const operatorProvider = createProvider('mock');
    Object.assign(operatorProvider, {
      placeOrder: operatorPlace,
      cancelOrder: operatorCancel,
    });
    app = await buildApp(operatorProvider, {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      keyRepo: new KeyRepo(KMS),
      userLoops: null, // loops exercised above; here we isolate the write path
      keyProviderFactory: (k) => {
        const stub = makeTradeStub(`ccxt:${k.exchange}`, k.apiKey);
        stubs.set(k.apiKey, stub);
        return stub as unknown as DataProvider;
      },
    });
    await app.ready();
    const signup = async (username: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username, password: 'correct-horse' } })).json()
        .token as string;
    tokenA = await signup('alice');
    tokenB = await signup('bob');
    tokenC = await signup('carol');
    const put = (token: string, apiKey: string, canTrade: boolean) =>
      app.inject({
        method: 'PUT',
        url: '/api/account/keys',
        headers: { authorization: `Bearer ${token}` },
        payload: { exchange: 'kraken', apiKey, secret: 'sss', canTrade },
      });
    await put(tokenA, 'alice-api-key', true);
    await put(tokenB, 'bob-api-key', false);
  });

  beforeEach(() => {
    operatorPlace.mockClear();
    operatorCancel.mockClear();
    for (const stub of stubs.values()) {
      stub.placeOrder.mockClear();
      stub.cancelOrder.mockClear();
      stub.getQuote.mockClear();
      stub.getOpenOrders.mockClear();
      stub.setOrders([]); // no leftover open orders from a prior cancel test
    }
  });

  afterAll(async () => {
    Object.assign(config, saved);
    await app.close();
  });

  const asA = () => ({ authorization: `Bearer ${tokenA}` });
  const asB = () => ({ authorization: `Bearer ${tokenB}` });
  const asC = () => ({ authorization: `Bearer ${tokenC}` });
  const order = (over: Partial<OrderRequest> = {}): OrderRequest =>
    ({ symbol: 'BTC/USDT', side: 'buy', type: 'limit', amount: 1, price: 100, ...over }) as OrderRequest;

  const expectHeld = (res: { statusCode: number; json(): Record<string, unknown> }) => {
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: 'TradingSafetyHold',
      message: EXECUTION_SAFETY_HOLD_REASON,
      statusCode: 503,
    });
  };

  it('reports cancel-only with each caller\'s resolved account-data source', async () => {
    const a = (await app.inject({ method: 'GET', url: '/api/trading/status', headers: asA() })).json();
    expect(a.enabled).toBe(false);
    expect(a.cancelEnabled).toBe(true);
    expect(a.mode).toBe('cancel-only');
    expect(a.reason).toBe(EXECUTION_SAFETY_HOLD_REASON);
    expect(a.source).toBe('ccxt:kraken');

    const b = (await app.inject({ method: 'GET', url: '/api/trading/status', headers: asB() })).json();
    expect(b.enabled).toBe(false);
    expect(b.cancelEnabled).toBe(true);
    expect(b.mode).toBe('cancel-only');
    expect(b.reason).toBe(EXECUTION_SAFETY_HOLD_REASON);
    expect(b.source).toBe('ccxt:kraken');

    const c = (await app.inject({ method: 'GET', url: '/api/trading/status', headers: asC() })).json();
    expect(c.enabled).toBe(false);
    expect(c.cancelEnabled).toBe(true);
    expect(c.mode).toBe('cancel-only');
    expect(c.reason).toBe(EXECUTION_SAFETY_HOLD_REASON);
    expect(c.source).toBe('per-user-keys');

    const system = (await app.inject({ method: 'GET', url: '/api/system', headers: asC() })).json();
    expect(system.tradingEnabled).toBe(false);
  });

  it('rejects all placements before validation, pricing, or provider access', async () => {
    await app.inject({ method: 'GET', url: '/api/orders', headers: asA() });
    const attempts = await Promise.all([
      app.inject({ method: 'POST', url: '/api/orders', headers: asA(), payload: order() }),
      app.inject({ method: 'POST', url: '/api/orders', headers: asA(), payload: order({ symbol: 'ETH/BTC' }) }),
      app.inject({ method: 'POST', url: '/api/orders', headers: asA(), payload: { nope: true } }),
      app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: asA(),
        payload: order({ clientOrderId: 'same-request' }),
      }),
      app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: asA(),
        payload: order({ clientOrderId: 'same-request' }),
      }),
    ]);
    attempts.forEach(expectHeld);
    expect(stubs.get('alice-api-key')!.placeOrder).not.toHaveBeenCalled();
    expect(stubs.get('alice-api-key')!.getQuote).not.toHaveBeenCalled();
  });

  it('cannot be bypassed by user key metadata or operator-backed credentials', async () => {
    await app.inject({ method: 'GET', url: '/api/orders', headers: asB() });
    const bobStub = stubs.get('bob-api-key');
    expect(bobStub).toBeDefined();
    const userAttempt = await app.inject({ method: 'POST', url: '/api/orders', headers: asB(), payload: order() });
    const operatorAttempt = await app.inject({ method: 'POST', url: '/api/orders', headers: asC(), payload: order() });
    expectHeld(userAttempt);
    expectHeld(operatorAttempt);
    expect(operatorPlace).not.toHaveBeenCalled();
    expect(bobStub!.placeOrder).not.toHaveBeenCalled();
  });

  it('keeps placement held and cancellation ownership-gated when authentication is disabled', async () => {
    const noAuthPlace = vi.fn();
    const noAuthCancel = vi.fn(async (id: string, symbol: string) => ({ id, symbol, status: 'canceled' }));
    const noAuthProvider = createProvider('mock');
    Object.assign(noAuthProvider, { placeOrder: noAuthPlace, cancelOrder: noAuthCancel });
    const noAuthApp = await buildApp(noAuthProvider, {
      auth: { enabled: false, allowSignup: false, secret: 'unused-test-secret' },
      userLoops: null,
      // Pinned origin = the accepted no-auth self-host posture; with the
      // default wildcard CORS these keyed surfaces fail closed instead
      // (keyedAccountGuard.test.ts).
      corsOrigin: 'http://localhost:8080',
    });
    await noAuthApp.ready();
    try {
      // Placement stays fail-closed even with no auth.
      const placed = await noAuthApp.inject({ method: 'POST', url: '/api/orders', payload: order() });
      expectHeld(placed);
      expect(noAuthPlace).not.toHaveBeenCalled();

      // A no-auth single-operator deployment with a pinned CORS origin reads
      // the base provider as the caller's own account — so canceling a resting
      // order from that account's open-orders list is live (the mock book
      // holds demo-1..3)…
      const canceled = await noAuthApp.inject({ method: 'DELETE', url: '/api/orders/demo-1?symbol=BTC/USDT' });
      expect(canceled.statusCode).toBe(200);
      expect(noAuthCancel).toHaveBeenCalledWith('demo-1', 'BTC/USDT');

      // …but an id outside that list is a 404 without touching the exchange.
      const unknown = await noAuthApp.inject({ method: 'DELETE', url: '/api/orders/some-order?symbol=BTC/USDT' });
      expect(unknown.statusCode).toBe(404);
      expect(noAuthCancel).toHaveBeenCalledTimes(1);
    } finally {
      await noAuthApp.close();
    }
  });

  it('cancels a user\'s own resting order through their own key', async () => {
    const aliceStub = stubs.get('alice-api-key')!;
    const bobStub = stubs.get('bob-api-key')!;
    aliceStub.setOrders([makeOpenOrder('alice-ord-1'), makeOpenOrder('alice-ord-2', 'ETH/USDT')]);
    bobStub.setOrders([makeOpenOrder('bob-ord-1')]);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/orders/alice-ord-1?symbol=BTC/USDT',
      headers: asA(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'alice-ord-1', symbol: 'BTC/USDT', status: 'canceled' });
    expect(aliceStub.cancelOrder).toHaveBeenCalledWith('alice-ord-1', 'BTC/USDT');
    expect(bobStub.cancelOrder).not.toHaveBeenCalled();
    expect(operatorCancel).not.toHaveBeenCalled();

    // The symbol falls back to the caller's own open-orders entry when the
    // query param is absent.
    const noQuery = await app.inject({ method: 'DELETE', url: '/api/orders/alice-ord-2', headers: asA() });
    expect(noQuery.statusCode).toBe(200);
    expect(aliceStub.cancelOrder).toHaveBeenCalledWith('alice-ord-2', 'ETH/USDT');
  });

  it('cross-user cancellation is a 404 — user B can never reach user A\'s order', async () => {
    const aliceStub = stubs.get('alice-api-key')!;
    const bobStub = stubs.get('bob-api-key')!;
    aliceStub.setOrders([makeOpenOrder('alice-ord-9')]);
    bobStub.setOrders([makeOpenOrder('bob-ord-9')]);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/orders/alice-ord-9?symbol=BTC/USDT',
      headers: asB(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/not among this account's open orders/);
    expect(aliceStub.cancelOrder).not.toHaveBeenCalled();
    expect(bobStub.cancelOrder).not.toHaveBeenCalled();
    expect(operatorCancel).not.toHaveBeenCalled();
  });

  it('a user without usable keys cannot cancel — never an operator-account fallback', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/orders/operator-order?symbol=BTC/USDT',
      headers: asC(),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(/never used as a fallback/i);
    expect(operatorCancel).not.toHaveBeenCalled();
  });

  it('an id outside the caller\'s open-orders list is a 404 before any cancel call', async () => {
    const aliceStub = stubs.get('alice-api-key')!;
    aliceStub.setOrders([]);
    const withSymbol = await app.inject({
      method: 'DELETE',
      url: '/api/orders/some-order?symbol=BTC/USDT',
      headers: asA(),
    });
    const withoutSymbol = await app.inject({ method: 'DELETE', url: '/api/orders/some-order', headers: asA() });
    expect(withSymbol.statusCode).toBe(404);
    expect(withoutSymbol.statusCode).toBe(404);
    expect(aliceStub.cancelOrder).not.toHaveBeenCalled();
    expect(operatorCancel).not.toHaveBeenCalled();
  });

  it('propagates the provider\'s honest outcomes: already-filled → 409, timeout → 502 unknown', async () => {
    const aliceStub = stubs.get('alice-api-key')!;
    aliceStub.setOrders([makeOpenOrder('alice-ord-3'), makeOpenOrder('alice-ord-4')]);
    aliceStub.cancelOrder
      .mockRejectedValueOnce(
        new ProviderError('Order alice-ord-3 on BTC/USDT is no longer open — already filled or canceled.', 409),
      )
      .mockRejectedValueOnce(
        new ProviderError(
          'Cancel outcome UNKNOWN for order alice-ord-4 on BTC/USDT — the exchange did not confirm (RequestTimeout). ' +
            'Check the exchange for the true order state before assuming it is open or canceled.',
          502,
          undefined,
          'upstream-unavailable',
          'cancel-outcome-unknown',
        ),
      );

    const conflict = await app.inject({
      method: 'DELETE',
      url: '/api/orders/alice-ord-3?symbol=BTC/USDT',
      headers: asA(),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().message).toMatch(/already filled or canceled/);

    const unknown = await app.inject({
      method: 'DELETE',
      url: '/api/orders/alice-ord-4?symbol=BTC/USDT',
      headers: asA(),
    });
    expect(unknown.statusCode).toBe(502);
    expect(unknown.json().message).toMatch(/outcome UNKNOWN/i);
    // An unknown outcome must never read as a successful cancel: the body is
    // an error, not a CancelResult.
    expect(unknown.json().error).toBe('ProviderError');
    expect(unknown.json().status).toBeUndefined();
  });

  it('preserves read-only account access while execution is held', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders', headers: asA() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: 'ccxt:kraken', provenance: 'live', orders: [] });
    expect(stubs.get('alice-api-key')!.getOpenOrders).toHaveBeenCalledTimes(1);
  });

  it('never falls back to operator account data for a user without usable stored keys', async () => {
    for (const url of ['/api/balances', '/api/orders', '/api/positions', '/api/fills']) {
      const res = await app.inject({ method: 'GET', url, headers: asC() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        source: 'per-user-keys',
        provenance: 'unavailable',
        note: expect.stringMatching(/never used as a fallback/i),
      });
    }

    const orderLookup = await app.inject({
      method: 'GET',
      url: '/api/orders/operator-order?symbol=BTC/USDT',
      headers: asC(),
    });
    expect(orderLookup.statusCode).toBe(503);
    expect(orderLookup.json().message).toMatch(/never used as a fallback/i);
  });
});

// ---------------------------------------------------------------------------
// Feed/curve isolation for keyed users
// ---------------------------------------------------------------------------

describe('per-user feed and equity isolation', () => {
  it('an authenticated tenant never sees the operator feed or curve, even before saving keys', async () => {
    process.env.LOG_LEVEL = 'silent';
    const operatorWatch = {
      stop: () => {},
      latestId: () => 7,
      eventsSince: () => [
        { id: 7, at: 0, kind: 'fill', orderId: 'op-1', symbol: 'BTC/USDT', side: 'buy', price: 1, amount: 1, filled: 1, filledDelta: 1, status: 'open' },
      ],
      tick: async () => {},
    } as unknown as AccountWatchHandle;
    const keyRepo = new KeyRepo(KMS);
    const app = await buildApp(createProvider('mock'), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      keyRepo,
      userLoops: null, // loops off — the resolver must still shield keyed users
      accountWatch: operatorWatch,
    });
    await app.ready();
    const token = (
      await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'kim', password: 'correct-horse' } })
    ).json().token as string;
    const auth = { authorization: `Bearer ${token}` };

    // Before storing keys: isolated and honestly unavailable, never the
    // operator's event feed or equity curve.
    const before = (await app.inject({ method: 'GET', url: '/api/account/events', headers: auth })).json();
    expect(before.watching).toBe(false);
    expect(before.latestId).toBe(0);
    expect(before.events).toEqual([]);
    expect(before.note).toMatch(/No per-user exchange key/);

    const equityBefore = (await app.inject({ method: 'GET', url: '/api/account/equity', headers: auth })).json();
    expect(equityBefore.watching).toBe(false);
    expect(equityBefore.points).toEqual([]);
    expect(equityBefore.note).toMatch(/No per-user exchange key/);

    await app.inject({
      method: 'PUT',
      url: '/api/account/keys',
      headers: auth,
      payload: { exchange: 'kraken', apiKey: 'kim-api-key', secret: 'sss', canTrade: false },
    });

    // After: keyed → their own (not running) feed, never the operator's events.
    const events = (await app.inject({ method: 'GET', url: '/api/account/events', headers: auth })).json();
    expect(events.watching).toBe(false);
    expect(events.events).toEqual([]);
    expect(events.note).toMatch(/Per-user account watcher/);

    const equity = (await app.inject({ method: 'GET', url: '/api/account/equity', headers: auth })).json();
    expect(equity.watching).toBe(false);
    expect(equity.points).toEqual([]);
    expect(equity.note).toMatch(/Per-user equity/);
    await app.close();
  });
});
