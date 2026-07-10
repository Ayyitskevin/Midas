import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import type { OrderBook, OrderBookLevel, Trade } from '@midas/shared';
import type { DataProvider } from './providers';
import { round } from './providers/util';
import { createCcxtStreamSource } from './ccxt-stream';

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
  /** False when the hub refused (global source ceiling) — the socket is NOT subscribed. */
  subscribe(socket: WebSocket, channel: string, symbol: string): boolean;
  unsubscribe(socket: WebSocket, channel: string, symbol: string): void;
  removeSocket(socket: WebSocket): void;
}

interface SourceEntry {
  stop: () => void;
  subscribers: Set<WebSocket>;
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
): StreamHub {
  const sources = new Map<string, SourceEntry>();
  // Live exchange websockets when the data provider is ccxt; synthetic otherwise.
  const ccxtSource = provider.name.startsWith('ccxt') ? createCcxtStreamSource() : null;

  function start(channel: string, symbol: string, subscribers: Set<WebSocket>): () => void {
    const emit = (data: unknown) => {
      const msg = JSON.stringify({ type: channel, symbol, data });
      for (const socket of subscribers) {
        if (socket.readyState === 1 /* OPEN */) socket.send(msg);
      }
    };
    if (ccxtSource) return ccxtSource.start(channel, symbol, emit);
    if (channel === 'trades') return startMockTrades(provider, symbol, emit);
    if (channel === 'orderbook') return startMockOrderBook(provider, symbol, emit);
    if (channel === 'ticker') return startMockTicker(provider, symbol, emit);
    return () => {};
  }

  return {
    subscribe(socket, channel, symbol) {
      const key = `${channel}\u0000${symbol}`;
      let entry = sources.get(key);
      if (!entry) {
        if (sources.size >= maxSources) return false;
        const subscribers = new Set<WebSocket>();
        entry = { stop: start(channel, symbol, subscribers), subscribers };
        sources.set(key, entry);
      }
      entry.subscribers.add(socket);
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

/** Register the WebSocket streaming endpoint. Requires @fastify/websocket. */
export function registerStream(app: FastifyInstance, hub: StreamHub): void {
  app.get('/api/stream', { websocket: true }, (socket: WebSocket) => {
    // Per-socket subscription ledger: bounds one connection's resource use
    // and lets close/error release exactly what this socket held.
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
          if (socket.readyState === 1) {
            socket.send(
              JSON.stringify({
                type: 'error',
                message: `Subscription limit reached (${MAX_SUBS_PER_SOCKET} per connection).`,
              }),
            );
          }
          return;
        }
        if (hub.subscribe(socket, req.channel, req.symbol)) held.add(key);
      } else {
        held.delete(key);
        hub.unsubscribe(socket, req.channel, req.symbol);
      }
    });
    socket.on('close', () => hub.removeSocket(socket));
    socket.on('error', () => hub.removeSocket(socket));
  });
}
