import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import type { OrderBook, OrderBookLevel, Trade } from '@midas/shared';
import type { DataProvider } from './providers';
import { round } from './providers/util';
import { createCcxtStreamSource, type StreamSource } from './ccxt-stream';

/**
 * Real-time streaming hub. Browser clients connect over a single WebSocket and
 * send `{ type: 'subscribe' | 'unsubscribe', channel, symbol }`. The hub keeps
 * one upstream source per (channel, symbol) shared across all subscribers
 * (ref-counted) and fans pushes out as `{ type: channel, symbol, data }`.
 *
 * Phase 4.1 ships the `trades` channel with a synthetic source; the CCXT Pro
 * websocket source lands in a later sub-phase behind this same interface.
 */
export interface StreamHub {
  /**
   * Subscribe a socket to (channel, symbol). Returns false when the hub refused
   * (global source ceiling) — the socket is NOT subscribed. `onDrop` is invoked
   * for this socket if the hub force-drops the source (a permanent upstream
   * failure), so the caller can release the ledger/quota it acquired for this
   * subscription — the hub cannot reach that per-connection state itself.
   */
  subscribe(socket: WebSocket, channel: string, symbol: string, onDrop?: () => void): boolean;
  unsubscribe(socket: WebSocket, channel: string, symbol: string): void;
  removeSocket(socket: WebSocket): void;
}

interface SourceEntry {
  stop: () => void;
  /** socket → its onDrop callback (run when the source dies permanently). */
  subscribers: Map<WebSocket, () => void>;
}

/**
 * Hard ceiling on concurrent upstream sources across ALL sockets. Every
 * unique (channel, symbol) pair costs a timer loop — or, on the ccxt
 * provider, a live exchange websocket subscription — so without a ceiling
 * one client could exhaust the process (or get the operator's IP banned
 * upstream) just by asking. 500 ≫ any real desk.
 */
const MAX_STREAM_SOURCES = 500;

export function createStreamHub(
  provider: DataProvider,
  maxSources: number = MAX_STREAM_SOURCES,
  // Live exchange websocket source on the ccxt provider, null otherwise (the
  // synthetic sources below handle non-ccxt). Injectable so a test can drive the
  // fatal-error teardown path without a real exchange.
  source: StreamSource | null = provider.name.startsWith('ccxt') ? createCcxtStreamSource() : null,
): StreamHub {
  const sources = new Map<string, SourceEntry>();

  function start(
    channel: string,
    symbol: string,
    subscribers: Map<WebSocket, () => void>,
  ): () => void {
    const key = `${channel}\u0000${symbol}`;
    const emit = (data: unknown) => {
      const msg = JSON.stringify({ type: channel, symbol, data });
      for (const socket of subscribers.keys()) {
        if (socket.readyState === 1 /* OPEN */) socket.send(msg);
      }
    };
    // A source that dies permanently (e.g. the exchange does not list the
    // symbol) must not linger: it would hold one of the global source slots and
    // any later subscriber to the same (channel, symbol) would join the entry
    // and hear nothing. Notify subscribers, run each one's onDrop so the WS
    // route releases the per-connection ledger + IP quota it holds for this
    // subscription (the hub can't reach that state itself), then drop the entry
    // so a fresh subscribe rebuilds (and retries) instead.
    const onFatal = (message: string): void => {
      const frame = JSON.stringify({ type: 'error', channel, symbol, message });
      for (const [socket, onDrop] of subscribers) {
        if (socket.readyState === 1 /* OPEN */) socket.send(frame);
        onDrop();
      }
      sources.delete(key);
    };
    if (source) return source.start(channel, symbol, emit, onFatal);
    if (channel === 'trades') return startMockTrades(provider, symbol, emit);
    if (channel === 'orderbook') return startMockOrderBook(provider, symbol, emit);
    if (channel === 'ticker') return startMockTicker(provider, symbol, emit);
    return () => {};
  }

  return {
    subscribe(socket, channel, symbol, onDrop) {
      const key = `${channel}\u0000${symbol}`;
      let entry = sources.get(key);
      if (!entry) {
        if (sources.size >= maxSources) return false;
        const subscribers = new Map<WebSocket, () => void>();
        entry = { stop: start(channel, symbol, subscribers), subscribers };
        sources.set(key, entry);
      }
      // Idempotent: re-subscribe just refreshes this socket's onDrop.
      entry.subscribers.set(socket, onDrop ?? (() => {}));
      return true;
    },

    unsubscribe(socket, channel, symbol) {
      const key = `${channel}\u0000${symbol}`;
      const entry = sources.get(key);
      if (!entry) return;
      entry.subscribers.delete(socket);
      if (entry.subscribers.size === 0) {
        entry.stop();
        sources.delete(key);
      }
    },

    removeSocket(socket) {
      for (const [key, entry] of sources) {
        if (entry.subscribers.delete(socket) && entry.subscribers.size === 0) {
          entry.stop();
          sources.delete(key);
        }
      }
    },
  };
}

/** Synthetic trade feed: seed the price from the provider, then random-walk prints. */
function startMockTrades(
  provider: DataProvider,
  symbol: string,
  emit: (trade: Trade) => void,
): () => void {
  let price = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  provider
    .getQuote(symbol)
    .then((q) => {
      price = q.price;
    })
    .catch(() => {
      price = 100;
    });

  const tick = () => {
    if (stopped) return;
    if (price > 0) {
      price *= 1 + (Math.random() - 0.5) * 0.0006;
      const side: 'buy' | 'sell' = Math.random() > 0.5 ? 'buy' : 'sell';
      const amount = Number((Math.random() * (price > 1000 ? 0.5 : 500) + 0.001).toFixed(4));
      emit({
        price: Number(price.toFixed(price > 1000 ? 2 : 6)),
        amount,
        side,
        timestamp: Date.now(),
      });
    }
    timer = setTimeout(tick, 250 + Math.random() * 600);
  };
  timer = setTimeout(tick, 200);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Synthetic order book that moves each tick (mid random-walks, levels rebuilt). */
function startMockOrderBook(
  provider: DataProvider,
  symbol: string,
  emit: (book: OrderBook) => void,
): () => void {
  const depth = 25;
  let price = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  provider
    .getQuote(symbol)
    .then((q) => {
      price = q.price;
    })
    .catch(() => {
      price = 100;
    });

  const tick = () => {
    if (stopped) return;
    if (price > 0) {
      price *= 1 + (Math.random() - 0.5) * 0.0004;
      const tickSize = Math.max(price * 0.0002, price < 1 ? 0.00001 : 0.01);
      const halfSpread = tickSize * (0.5 + Math.random());
      const sizeBase = Math.min(Math.max(50_000 / price, 0.5), 5_000);
      const bids: OrderBookLevel[] = [];
      const asks: OrderBookLevel[] = [];
      for (let i = 0; i < depth; i++) {
        const grow = 1 + i * 0.12;
        bids.push({
          price: round(price - halfSpread - i * tickSize * (1 + Math.random() * 0.4), 6),
          amount: round(sizeBase * (0.2 + Math.random() * 1.6) * grow, 4),
        });
        asks.push({
          price: round(price + halfSpread + i * tickSize * (1 + Math.random() * 0.4), 6),
          amount: round(sizeBase * (0.2 + Math.random() * 1.6) * grow, 4),
        });
      }
      emit({ symbol, bids, asks, timestamp: Date.now() });
    }
    timer = setTimeout(tick, 600 + Math.random() * 400);
  };
  timer = setTimeout(tick, 150);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Synthetic ticker: a live price + 24h change, random-walked from the seed. */
function startMockTicker(
  provider: DataProvider,
  symbol: string,
  emit: (t: { price: number; changePercent: number }) => void,
): () => void {
  let price = 0;
  let prevClose = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  provider
    .getQuote(symbol)
    .then((q) => {
      price = q.price;
      prevClose = q.previousClose || q.price;
    })
    .catch(() => {
      price = 100;
      prevClose = 100;
    });

  const tick = () => {
    if (stopped) return;
    if (price > 0) {
      price *= 1 + (Math.random() - 0.5) * 0.0006;
      const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
      emit({ price: round(price, price > 1000 ? 2 : 6), changePercent: round(changePercent, 2) });
    }
    timer = setTimeout(tick, 1000 + Math.random() * 500);
  };
  timer = setTimeout(tick, 200);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// The /api/stream endpoint is public even with auth on (browsers cannot set
// WS auth headers), so its input handling is the server's most exposed edge:
// everything below is bounded before it can allocate anything. The frame size
// is capped twice — once here (a belt-and-suspenders re-check) and, crucially,
// at the ws protocol layer via the plugin's `maxPayload` (app.ts), so an
// oversized frame is rejected before ws buffers it into the heap.
const STREAM_CHANNELS = new Set(['trades', 'orderbook', 'ticker']);
const STREAM_SYMBOL_RE = /^[A-Z0-9/:^=._-]{1,64}$/;
/** Max bytes for one client frame — enforced at the ws layer (maxPayload) AND here. */
export const MAX_STREAM_FRAME_BYTES = 512; // a real subscribe message is ~70 bytes
const MAX_SUBS_PER_SOCKET = 60; // a 20-panel desk × 3 channels still fits
/**
 * Max live subscriptions one client IP may hold across ALL its sockets. The hub's
 * global source ceiling protects the process, but on its own it is
 * first-come-first-served — a per-IP budget keeps one client from taking the
 * whole pool and starving everyone else. 120 ≪ the 500 global ceiling, so the
 * pool always has headroom for other clients.
 */
const MAX_SUBS_PER_IP = 120;

/**
 * A per-key (client IP) budget over the shared, globally-bounded source pool.
 * `tryAcquire` returns false once a key is at its cap; `release` returns a slot.
 * Pure and exported for tests.
 */
export function createIpQuota(maxPerKey: number): {
  tryAcquire(key: string): boolean;
  release(key: string): void;
  countFor(key: string): number;
} {
  const counts = new Map<string, number>();
  return {
    tryAcquire(key) {
      const n = counts.get(key) ?? 0;
      if (n >= maxPerKey) return false;
      counts.set(key, n + 1);
      return true;
    },
    release(key) {
      const n = counts.get(key) ?? 0;
      if (n <= 1) counts.delete(key);
      else counts.set(key, n - 1);
    },
    countFor(key) {
      return counts.get(key) ?? 0;
    },
  };
}

export interface StreamRequest {
  type: 'subscribe' | 'unsubscribe';
  channel: string;
  symbol: string;
}

/**
 * Parse + validate one client frame. Null for anything malformed: oversized
 * frames, non-JSON, unknown channels, junk symbols. Exported for tests.
 */
export function parseStreamRequest(
  raw: { toString(): string },
  byteLength: number,
): StreamRequest | null {
  if (byteLength > MAX_STREAM_FRAME_BYTES) return null;
  let msg: { type?: unknown; channel?: unknown; symbol?: unknown };
  try {
    msg = JSON.parse(raw.toString()) as typeof msg;
  } catch {
    return null;
  }
  if (msg.type !== 'subscribe' && msg.type !== 'unsubscribe') return null;
  const channel = (typeof msg.channel === 'string' ? msg.channel : 'trades').toLowerCase();
  if (!STREAM_CHANNELS.has(channel)) return null;
  const symbol = (typeof msg.symbol === 'string' ? msg.symbol : '').trim().toUpperCase();
  if (!STREAM_SYMBOL_RE.test(symbol)) return null;
  return { type: msg.type, channel, symbol };
}

/** Send a JSON error frame to a still-open socket. */
function sendError(socket: WebSocket, message: string): void {
  if (socket.readyState === 1 /* OPEN */) socket.send(JSON.stringify({ type: 'error', message }));
}

/** Register the WebSocket streaming endpoint. Requires @fastify/websocket. */
export function registerStream(app: FastifyInstance, hub: StreamHub): void {
  // Per-client budget over the shared source pool — lives for the app's lifetime,
  // keyed by req.ip (real client IP when trustProxy is configured).
  const ipQuota = createIpQuota(MAX_SUBS_PER_IP);

  app.get('/api/stream', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const ip = request.ip;
    // Per-socket subscription ledger: bounds one connection's resource use and
    // lets close/error release exactly what this socket held (and its IP quota).
    const held = new Set<string>();

    socket.on('message', (raw: RawData) => {
      const byteLength =
        typeof raw === 'string' ? Buffer.byteLength(raw) : ((raw as Buffer).length ?? 0);
      const req = parseStreamRequest(raw, byteLength);
      if (!req) return; // malformed input is dropped, never processed
      const key = `${req.channel} ${req.symbol}`;

      if (req.type === 'subscribe') {
        if (held.has(key)) return; // idempotent re-subscribe
        if (held.size >= MAX_SUBS_PER_SOCKET) {
          // The one violation a legitimate power user could hit — tell them.
          sendError(socket, `Subscription limit reached (${MAX_SUBS_PER_SOCKET} per connection).`);
          return;
        }
        // Per-IP fairness: keep one client from monopolizing the shared pool and
        // starving other clients, even across many sockets.
        if (!ipQuota.tryAcquire(ip)) {
          sendError(socket, `Subscription limit reached (${MAX_SUBS_PER_IP} per client).`);
          return;
        }
        const acquired = hub.subscribe(socket, req.channel, req.symbol, () => {
          // The hub force-dropped this source (a permanent upstream failure,
          // e.g. an unlisted symbol). Release our ledger slot + IP quota so this
          // connection isn't charged for a dead stream and can re-subscribe to a
          // valid symbol. Idempotent with the unsubscribe/close paths below.
          if (held.delete(key)) ipQuota.release(ip);
        });
        if (acquired) held.add(key);
        else ipQuota.release(ip); // hub refused (global ceiling) — return the slot
      } else {
        // Only release what this socket actually held (unsubscribe is idempotent).
        if (held.delete(key)) {
          hub.unsubscribe(socket, req.channel, req.symbol);
          ipQuota.release(ip);
        }
      }
    });

    const cleanup = (): void => {
      hub.removeSocket(socket);
      held.forEach(() => ipQuota.release(ip)); // free every slot this socket held
      held.clear();
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
