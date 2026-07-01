import { describe, it, expect } from 'vitest';
import type { AccountProvenance, OpenOrder, OpenOrders, PlacedOrder } from '@midas/shared';
import {
  createAccountWatcher,
  diffOpenOrders,
  formatAccountEvent,
  registerAccountEventsRoute,
  resolveClosedKind,
  type AccountWatchHandle,
} from './accountWatch';
import type { DataProvider } from './providers';
import Fastify from 'fastify';

const order = (id: string, over: Partial<OpenOrder> = {}): OpenOrder => ({
  id,
  symbol: 'BTC/USDT',
  side: 'buy',
  type: 'limit',
  price: 60000,
  amount: 1,
  filled: 0,
  remaining: 1,
  value: 60000,
  timestamp: 0,
  status: 'open',
  ...over,
});

const snap = (orders: OpenOrder[], provenance: AccountProvenance = 'live'): OpenOrders => ({
  source: 'stub',
  provenance,
  note: null,
  orders,
  asOf: 0,
});

const placed = (over: Partial<PlacedOrder> = {}): PlacedOrder => ({
  id: 'a',
  clientOrderId: null,
  symbol: 'BTC/USDT',
  side: 'buy',
  type: 'limit',
  amount: 1,
  price: 60000,
  filled: 0,
  status: 'open',
  timestamp: 0,
  ...over,
});

/** Provider stub: serves snapshots in sequence (last one repeats), optional getOrder. */
function stubProvider(
  snapshots: OpenOrders[],
  getOrder?: (id: string, symbol: string) => Promise<PlacedOrder>,
): DataProvider {
  let i = 0;
  return {
    name: 'stub',
    live: true,
    getOpenOrders: async () => snapshots[Math.min(i++, snapshots.length - 1)],
    getOrder,
  } as unknown as DataProvider;
}

describe('diffOpenOrders', () => {
  it('reports appearances, fill increases and disappearances by order id', () => {
    const prev = [order('a'), order('b', { filled: 0.2 }), order('c')];
    const next = [order('b', { filled: 0.5 }), order('c'), order('d')];
    const deltas = diffOpenOrders(prev, next);
    expect(deltas).toHaveLength(3);
    expect(deltas.find((d) => d.kind === 'new')?.order.id).toBe('d');
    const fill = deltas.find((d) => d.kind === 'fill');
    expect(fill?.order.id).toBe('b');
    expect(fill?.filledDelta).toBeCloseTo(0.3);
    expect(deltas.find((d) => d.kind === 'closed')?.order.id).toBe('a');
  });

  it('is empty for identical snapshots and ignores float noise in filled', () => {
    const a = [order('a', { filled: 0.1 })];
    expect(diffOpenOrders(a, [order('a', { filled: 0.1 + 1e-14 })])).toHaveLength(0);
    expect(diffOpenOrders([], [])).toHaveLength(0);
  });
});

describe('resolveClosedKind', () => {
  it('maps exchange statuses honestly', () => {
    expect(resolveClosedKind('canceled', 0, 1)).toBe('canceled');
    expect(resolveClosedKind('cancelled', 0, 1)).toBe('canceled');
    expect(resolveClosedKind('expired', 0, 1)).toBe('canceled');
    expect(resolveClosedKind('rejected', 0, 1)).toBe('canceled');
    expect(resolveClosedKind('closed', 1, 1)).toBe('filled'); // ccxt's fully-executed status
    expect(resolveClosedKind('filled', 1, 1)).toBe('filled');
  });

  it('falls back to the fill ratio, staying "closed" (unknown) when it cannot tell', () => {
    expect(resolveClosedKind(null, 1, 1)).toBe('filled');
    expect(resolveClosedKind(null, 0.9995, 1)).toBe('filled'); // within rounding of full
    expect(resolveClosedKind(null, 0.5, 1)).toBe('closed');
    expect(resolveClosedKind('open', null, 1)).toBe('closed');
  });
});

describe('account watcher engine', () => {
  it('baselines the first live snapshot silently — no replay of pre-existing orders', async () => {
    const w = createAccountWatcher({ provider: stubProvider([snap([order('a'), order('b')])]) });
    await w.tick();
    await w.tick();
    expect(w.latestId()).toBe(0);
    expect(w.eventsSince(0)).toHaveLength(0);
  });

  it('emits new / fill events and pushes ONLY executions to notify', async () => {
    const notified: string[] = [];
    const w = createAccountWatcher({
      provider: stubProvider([
        snap([order('a')]),
        snap([order('a', { filled: 0.4 }), order('b')]),
      ]),
      notify: (t) => notified.push(t),
      now: () => 1234,
    });
    await w.tick(); // baseline
    await w.tick();
    const events = w.eventsSince(0);
    expect(events).toHaveLength(2);
    const fill = events.find((e) => e.kind === 'fill');
    expect(fill?.orderId).toBe('a');
    expect(fill?.filledDelta).toBeCloseTo(0.4);
    expect(fill?.at).toBe(1234);
    expect(events.find((e) => e.kind === 'new')?.orderId).toBe('b');
    // 'new' is feed/toast-only — the write path already webhooks placements.
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatch(/⚡ Fill/);
  });

  it('resolves a vanished order via provider.getOrder (canceled vs filled)', async () => {
    const lookups: string[] = [];
    const w = createAccountWatcher({
      provider: stubProvider(
        [
          snap([order('gone-canceled'), order('gone-filled', { filled: 0.3 })]),
          snap([]),
        ],
        async (id) => {
          lookups.push(id);
          return id === 'gone-canceled'
            ? placed({ id, status: 'canceled', filled: 0 })
            : placed({ id, status: 'closed', filled: 1 });
        },
      ),
    });
    await w.tick();
    await w.tick();
    const events = w.eventsSince(0);
    expect(lookups.sort()).toEqual(['gone-canceled', 'gone-filled']);
    expect(events.find((e) => e.orderId === 'gone-canceled')?.kind).toBe('canceled');
    const filled = events.find((e) => e.orderId === 'gone-filled');
    expect(filled?.kind).toBe('filled');
    expect(filled?.filled).toBe(1);
    expect(filled?.filledDelta).toBeCloseTo(0.7); // 1 - the 0.3 last seen on the book
  });

  it('stays honestly "closed" when the provider has no getOrder or the lookup fails', async () => {
    const noLookup = createAccountWatcher({
      provider: stubProvider([snap([order('a', { filled: 0.2 })]), snap([])]),
    });
    await noLookup.tick();
    await noLookup.tick();
    expect(noLookup.eventsSince(0)[0]?.kind).toBe('closed');

    const failing = createAccountWatcher({
      provider: stubProvider([snap([order('a')]), snap([])], async () => {
        throw new Error('venue error');
      }),
    });
    await failing.tick();
    await failing.tick();
    expect(failing.eventsSince(0)[0]?.kind).toBe('closed');
  });

  it('skips non-live snapshots — an outage is never misread as orders closing', async () => {
    const w = createAccountWatcher({
      provider: stubProvider([
        snap([order('a')]),
        snap([], 'unavailable'), // keys/exchange hiccup
        snap([order('a')]), // order still there once the read recovers
      ]),
    });
    await w.tick();
    await w.tick();
    await w.tick();
    expect(w.eventsSince(0)).toHaveLength(0);
  });

  it('serves an id-cursor feed and bounds the buffer', async () => {
    const w = createAccountWatcher({
      provider: stubProvider([
        snap([]),
        snap([order('a')]),
        snap([order('a'), order('b')]),
        snap([order('a'), order('b'), order('c')]),
      ]),
      maxEvents: 2,
    });
    for (let i = 0; i < 4; i++) await w.tick();
    expect(w.latestId()).toBe(3);
    expect(w.eventsSince(0)).toHaveLength(2); // ring buffer dropped the oldest
    expect(w.eventsSince(2).map((e) => e.orderId)).toEqual(['c']);
    expect(w.eventsSince(3)).toHaveLength(0);
  });
});

describe('formatAccountEvent', () => {
  const base = {
    id: 1,
    at: 0,
    orderId: '42',
    symbol: 'BTC/USDT',
    side: 'buy' as const,
    price: 60000,
    amount: 1,
    filled: 0.4,
    filledDelta: 0.4,
    status: 'open',
  };

  it('describes each kind with side, size and price', () => {
    expect(formatAccountEvent({ ...base, kind: 'fill' })).toBe(
      '⚡ Fill — BUY 0.4 BTC/USDT @ 60000 (0.4/1 filled, order 42)',
    );
    expect(formatAccountEvent({ ...base, kind: 'filled', filled: 1 })).toBe(
      '✅ Order filled — BUY 1 BTC/USDT @ 60000 (order 42)',
    );
    expect(formatAccountEvent({ ...base, kind: 'canceled' })).toMatch(/✖ Order canceled — BUY 1 BTC\/USDT @ 60000/);
    expect(formatAccountEvent({ ...base, kind: 'new' })).toMatch(/📥 New order on book/);
    expect(formatAccountEvent({ ...base, kind: 'closed' })).toMatch(/final status unknown/);
  });

  it('omits the price for market orders', () => {
    expect(formatAccountEvent({ ...base, kind: 'filled', price: null })).toBe(
      '✅ Order filled — BUY 1 BTC/USDT (order 42)',
    );
  });
});

describe('GET /api/account/events', () => {
  it('says watching:false (with the reason) when no watcher is running', async () => {
    const app = Fastify();
    registerAccountEventsRoute(app, null);
    const res = await app.inject({ method: 'GET', url: '/api/account/events' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watching).toBe(false);
    expect(body.latestId).toBe(0);
    expect(body.note).toMatch(/MIDAS_ACCOUNT_WATCH_MS/);
    await app.close();
  });

  it('serves the feed and honors ?since=', async () => {
    const w = createAccountWatcher({
      provider: stubProvider([snap([]), snap([order('a')]), snap([order('a'), order('b')])]),
    });
    await w.tick();
    await w.tick();
    await w.tick();
    const app = Fastify();
    registerAccountEventsRoute(app, w as AccountWatchHandle);
    const all = (await app.inject({ method: 'GET', url: '/api/account/events' })).json();
    expect(all.watching).toBe(true);
    expect(all.latestId).toBe(2);
    expect(all.events).toHaveLength(2);
    const sinced = (await app.inject({ method: 'GET', url: '/api/account/events?since=1' })).json();
    expect(sinced.events.map((e: { orderId: string }) => e.orderId)).toEqual(['b']);
    const bad = (await app.inject({ method: 'GET', url: '/api/account/events?since=banana' })).json();
    expect(bad.events).toHaveLength(2); // junk cursor = from the start
    await app.close();
  });
});
