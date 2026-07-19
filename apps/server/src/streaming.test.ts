import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DataProvider } from './providers';
import { createIpQuota, createStreamHub, parseStreamRequest, registerStream } from './streaming';
import type { StreamSource } from './ccxt-stream';

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

describe('createStreamHub fatal-source teardown', () => {
  it('on a fatal death: error-frames subscribers, runs each onDrop, and rebuilds on a fresh subscribe', () => {
    const { provider } = countingProvider();
    let startCalls = 0;
    let reportFatal: ((message: string) => void) | undefined;
    // Injected source: capture onFatal so the test can trigger a permanent death.
    const injected: StreamSource = {
      start(_channel, _symbol, _emit, onFatal) {
        startCalls += 1;
        reportFatal = onFatal;
        return () => {};
      },
    };
    const hub = createStreamHub(provider, 500, injected);
    const sent: string[] = [];
    const sock = { readyState: 1, send: (m: string) => sent.push(m) } as unknown as WebSocket;
    let dropped = 0;

    expect(hub.subscribe(sock, 'trades', 'JUNK/USDT', () => (dropped += 1))).toBe(true);
    expect(startCalls).toBe(1);

    // The upstream source dies permanently (e.g. the exchange does not list it).
    reportFatal?.('the exchange does not list it');
    // The subscriber is told which (channel, symbol) failed and its onDrop ran...
    expect(sent.some((m) => m.includes('"type":"error"') && m.includes('JUNK/USDT'))).toBe(true);
    expect(dropped).toBe(1);
    // ...and the dead entry is gone, so a fresh subscribe rebuilds it (retries).
    expect(hub.subscribe(sock, 'trades', 'JUNK/USDT')).toBe(true);
    expect(startCalls).toBe(2);
  });

  it('through registerStream: a fatal death releases the socket ledger + IP quota so re-subscribe rebuilds', () => {
    // The bug this guards: onFatal freeing only the hub slot left the WS route's
    // per-socket `held` set + ipQuota charging for the dead source, and the
    // held-idempotency guard then permanently blocked that connection from
    // rebuilding. Drive the real /api/stream message handler across a fatal death.
    const { provider } = countingProvider();
    let startCalls = 0;
    let reportFatal: ((message: string) => void) | undefined;
    const injected: StreamSource = {
      start(_channel, _symbol, _emit, onFatal) {
        startCalls += 1;
        reportFatal = onFatal;
        return () => {};
      },
    };
    const hub = createStreamHub(provider, 500, injected);

    // Capture the ws handler registerStream installs, then drive it directly.
    let wsHandler: ((s: WebSocket, r: FastifyRequest) => void) | undefined;
    const app = {
      get: (_path: string, _opts: unknown, h: (s: WebSocket, r: FastifyRequest) => void) => {
        wsHandler = h;
      },
    } as unknown as FastifyInstance;
    registerStream(app, hub);

    const listeners: Record<string, (arg?: unknown) => void> = {};
    const sock = {
      readyState: 1,
      send: () => {},
      on: (ev: string, cb: (arg?: unknown) => void) => {
        listeners[ev] = cb;
      },
    } as unknown as WebSocket;
    wsHandler!(sock, { ip: '9.9.9.9' } as unknown as FastifyRequest);

    const send = (msg: unknown) => listeners.message(Buffer.from(JSON.stringify(msg)));
    send({ type: 'subscribe', channel: 'trades', symbol: 'JUNK/USDT' });
    expect(startCalls).toBe(1);

    // Source dies permanently → hub error-frames + runs the WS route's onDrop,
    // which releases this socket's `held` slot and IP quota.
    reportFatal?.('gone');

    // A fresh subscribe is no longer swallowed by the held guard → rebuilds.
    send({ type: 'subscribe', channel: 'trades', symbol: 'JUNK/USDT' });
    expect(startCalls).toBe(2);
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
