import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import type { DataProvider } from './providers';
import { createIpQuota, createStreamHub, parseStreamRequest } from './streaming';

/** Counts how many sources the hub actually started (each seeds one quote). */
function countingProvider(): { provider: DataProvider; starts: () => number } {
  let quotes = 0;
  const provider = {
    name: 'stub',
    live: false,
    getQuote: async (symbol: string) => {
      quotes += 1;
      return { symbol, price: 100, changePercent: 0 };
    },
  } as unknown as DataProvider;
  return { provider, starts: () => quotes };
}

function fakeSocket(): WebSocket {
  return { readyState: 1, send: () => {} } as unknown as WebSocket;
}

const frame = (msg: unknown): [{ toString(): string }, number] => {
  const s = JSON.stringify(msg);
  return [{ toString: () => s }, Buffer.byteLength(s)];
};

describe('parseStreamRequest', () => {
  it('accepts a real subscribe and normalizes channel/symbol', () => {
    expect(parseStreamRequest(...frame({ type: 'subscribe', symbol: 'btc/usdt' }))).toEqual({
      type: 'subscribe',
      channel: 'trades', // the default channel
      symbol: 'BTC/USDT',
    });
    expect(
      parseStreamRequest(...frame({ type: 'unsubscribe', channel: 'ORDERBOOK', symbol: 'ETH/USDT' })),
    ).toEqual({ type: 'unsubscribe', channel: 'orderbook', symbol: 'ETH/USDT' });
  });

  it('rejects malformed input outright', () => {
    // Not JSON.
    expect(parseStreamRequest({ toString: () => 'not json' }, 8)).toBeNull();
    // Unknown message type.
    expect(parseStreamRequest(...frame({ type: 'exec', symbol: 'BTC/USDT' }))).toBeNull();
    // Channel outside the allowlist never reaches the hub.
    expect(parseStreamRequest(...frame({ type: 'subscribe', channel: 'shell', symbol: 'BTC/USDT' }))).toBeNull();
    // Junk symbols: empty, whitespace, charset violations, unbounded length.
    expect(parseStreamRequest(...frame({ type: 'subscribe', symbol: '' }))).toBeNull();
    expect(parseStreamRequest(...frame({ type: 'subscribe', symbol: 'BTC USDT' }))).toBeNull();
    expect(parseStreamRequest(...frame({ type: 'subscribe', symbol: 'A'.repeat(65) }))).toBeNull();
    // Oversized frames are dropped before JSON.parse ever runs.
    const big = JSON.stringify({ type: 'subscribe', symbol: 'BTC/USDT', pad: 'x'.repeat(600) });
    expect(parseStreamRequest({ toString: () => big }, Buffer.byteLength(big))).toBeNull();
  });
});

describe('createStreamHub resource bounds', () => {
  it('shares one upstream source per (channel, symbol) pair', () => {
    const { provider, starts } = countingProvider();
    const hub = createStreamHub(provider);
    const a = fakeSocket();
    const b = fakeSocket();

    expect(hub.subscribe(a, 'trades', 'BTC/USDT')).toBe(true);
    expect(hub.subscribe(b, 'trades', 'BTC/USDT')).toBe(true);
    expect(starts()).toBe(1); // second subscriber joined the existing source

    hub.removeSocket(a);
    hub.removeSocket(b);
    expect(hub.subscribe(a, 'trades', 'BTC/USDT')).toBe(true);
    expect(starts()).toBe(2); // last-out stopped it; re-subscribe starts fresh
    hub.removeSocket(a);
  });

  it('refuses NEW sources past the global ceiling but keeps existing pairs joinable', () => {
    const { provider } = countingProvider();
    const hub = createStreamHub(provider, 2);
    const a = fakeSocket();
    const b = fakeSocket();

    expect(hub.subscribe(a, 'trades', 'AAA/USDT')).toBe(true);
    expect(hub.subscribe(a, 'trades', 'BBB/USDT')).toBe(true);
    // At the ceiling: a third unique pair is refused…
    expect(hub.subscribe(a, 'trades', 'CCC/USDT')).toBe(false);
    // …but joining an already-running source costs nothing and still works.
    expect(hub.subscribe(b, 'trades', 'AAA/USDT')).toBe(true);

    // Teardown releases capacity.
    hub.removeSocket(a);
    hub.removeSocket(b);
    expect(hub.subscribe(a, 'trades', 'CCC/USDT')).toBe(true);
    hub.removeSocket(a);
  });
});

describe('createIpQuota (per-client stream fairness)', () => {
  it('caps subscriptions per client key, isolates clients, and frees on release', () => {
    const q = createIpQuota(2);
    expect(q.tryAcquire('1.1.1.1')).toBe(true);
    expect(q.tryAcquire('1.1.1.1')).toBe(true);
    // At the cap: one client cannot take more of the shared pool…
    expect(q.tryAcquire('1.1.1.1')).toBe(false);
    expect(q.countFor('1.1.1.1')).toBe(2);
    // …and a different client is unaffected by the first's usage.
    expect(q.tryAcquire('2.2.2.2')).toBe(true);

    // Releasing frees a slot back for that client.
    q.release('1.1.1.1');
    expect(q.countFor('1.1.1.1')).toBe(1);
    expect(q.tryAcquire('1.1.1.1')).toBe(true);

    // Over-release never goes negative or grants free capacity.
    q.release('2.2.2.2');
    q.release('2.2.2.2');
    expect(q.countFor('2.2.2.2')).toBe(0);
    expect(q.tryAcquire('2.2.2.2')).toBe(true);
  });
});
