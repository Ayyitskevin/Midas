import * as ccxt from 'ccxt';
import { numEnv } from './config';

/**
 * Live streaming source backed by CCXT Pro websockets. One exchange instance
 * multiplexes every (channel, symbol) watch loop over a single connection.
 * Selected automatically when MIDAS_DATA_PROVIDER=ccxt.
 *
 * Requires outbound network access to the exchange's websocket endpoint; in
 * restricted/sandboxed environments the mock stream sources are used instead.
 */
type Emit = (data: unknown) => void;

export interface ProExchange {
  watchTrades(symbol: string): Promise<
    Array<{ price?: number; amount?: number; side?: string; timestamp?: number }>
  >;
  watchOrderBook(
    symbol: string,
    limit?: number,
  ): Promise<{ bids: number[][]; asks: number[][]; timestamp?: number }>;
  watchTicker(symbol: string): Promise<{ last?: number; close?: number; percentage?: number }>;
  // Unsubscribe a single (channel, symbol) so ccxt tears down the exchange-side
  // subscription and its per-symbol cache. Optional: present on current ccxt pro
  // builds, absent on the minimal test fakes — always feature-detected before use.
  unWatchTrades?(symbol: string): Promise<unknown>;
  unWatchOrderBook?(symbol: string): Promise<unknown>;
  unWatchTicker?(symbol: string): Promise<unknown>;
  close?(): Promise<void>;
}

/**
 * Finite number or null — NEVER coerce a missing field to 0. Under a LIVE badge
 * a fabricated 0 reads as a real print/level (see providers/ccxt/helpers.ts
 * tickerPrice, which documents the same rule); callers drop the row instead.
 */
function n(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface StreamSource {
  /**
   * False when no live upstream exchange could be built — `start` is then a
   * no-op and nothing will ever arrive. Liveness surfaces (health, UI badge)
   * must never claim "live" over an unavailable source. Optional so the
   * minimal test fakes (and the synthetic sources) needn't set it.
   */
  readonly available?: boolean;
  /**
   * Begin streaming (channel, symbol); returns a stop function. `onFatal` is
   * invoked when the source dies permanently (e.g. the exchange does not list
   * the symbol) so the caller can tear its bookkeeping down rather than hold a
   * silent dead source.
   */
  start(channel: string, symbol: string, emit: Emit, onFatal?: (message: string) => void): () => void;
}

/**
 * Unsubscribe one (channel, symbol) from the shared exchange — but only if the
 * installed ccxt build (and the injected test fake) exposes the matching unWatch
 * method. Best-effort: a rejection (e.g. it was never subscribed) is swallowed.
 * Never calls close(): the exchange instance multiplexes every stream over one
 * connection, so closing it would kill unrelated symbols' feeds.
 */
function unwatch(ex: ProExchange, channel: string, symbol: string): void {
  const fn =
    channel === 'trades'
      ? ex.unWatchTrades
      : channel === 'orderbook'
        ? ex.unWatchOrderBook
        : channel === 'ticker'
          ? ex.unWatchTicker
          : undefined;
  if (typeof fn === 'function') {
    // Defer via .then so even a synchronously-throwing unWatch becomes a
    // rejection the .catch swallows — stop() must never throw, whatever the
    // exchange (or a test fake) does.
    Promise.resolve()
      .then(() => fn.call(ex, symbol))
      .catch(() => {});
  }
}

/**
 * ccxt raises BadSymbol for a market the exchange does not list — a permanent
 * error, not a transient disconnect. Detected by class name so it survives the
 * CJS/ESM interop (the class isn't reliably reachable off the namespace).
 */
function isUnknownSymbol(err: unknown): boolean {
  return err instanceof Error && err.constructor?.name === 'BadSymbol';
}

/** The CCXT Pro constructor for the configured exchange id, when it exists. */
function proCtor(): (new (config: object) => ProExchange) | null {
  const id = (process.env.MIDAS_CCXT_EXCHANGE ?? 'binance').toLowerCase();
  const proNs = (ccxt as unknown as {
    pro: Record<string, new (config: object) => ProExchange>;
  }).pro;
  const Ctor = proNs?.[id];
  return typeof Ctor === 'function' ? Ctor : null;
}

/**
 * Whether a live CCXT Pro websocket source can actually be built for the
 * configured exchange. False when ccxt.pro has no support for the id — in that
 * case NOTHING will ever stream, and no surface may claim "live". Cheap (no
 * exchange instance is constructed), so /api/health can evaluate it per poll.
 */
export function ccxtProAvailable(): boolean {
  return proCtor() !== null;
}

/** Build the CCXT Pro exchange for the configured id, or null when unavailable. */
function buildProExchange(): ProExchange | null {
  const Ctor = proCtor();
  return Ctor ? new Ctor({ enableRateLimit: true }) : null;
}

export interface CcxtStreamOptions {
  /**
   * Ms of upstream silence before the parked watch is abandoned and the loop
   * re-subscribes. Tradeoff: an illiquid symbol can legitimately print nothing
   * for minutes, so no timeout perfectly separates "quiet market" from "dead
   * socket" — the 60s default errs toward fast recovery for the liquid symbols
   * a terminal actually watches; a genuinely quiet symbol pays one harmless
   * re-subscribe per window instead of a forever-frozen panel under a LIVE
   * badge. 0 disables the watchdog.
   */
  stallMs?: number;
  /** First transient-failure retry delay in ms; doubles per consecutive failure. */
  retryMinMs?: number;
  /** Cap on the retry delay in ms. */
  retryMaxMs?: number;
}

/**
 * Consecutive stall-watchdog restarts tolerated before the source is declared
 * dead via onFatal. With the 60s default stall window this is ~5 minutes of
 * absolute upstream silence — long enough that even a quiet symbol almost
 * certainly printed SOMETHING, so reporting the feed dead (and freeing the
 * slot) beats faking liveness over a frozen panel.
 */
const MAX_CONSECUTIVE_STALLS = 5;

/**
 * Transient-retry delay: exponential backoff with 50–100% jitter, capped.
 * Fixed 1s retries across up to 500 sources fire in lockstep — a thundering
 * herd that can prolong an upstream IP ban; jitter desynchronizes them.
 * Exported for tests.
 */
export function retryDelay(failures: number, minMs: number, maxMs: number): number {
  const base = Math.min(maxMs, minMs * 2 ** failures);
  return base * (0.5 + Math.random() * 0.5);
}

/** Sentinel rejection: the parked watch delivered nothing within stallMs. */
class StreamStallError extends Error {
  constructor() {
    super('upstream stream stalled');
    this.name = 'StreamStallError';
  }
}

/**
 * @param injected test seam — pass a fake ProExchange (or null); omit in
 *   production to build the live exchange from MIDAS_CCXT_EXCHANGE.
 */
export function createCcxtStreamSource(
  injected?: ProExchange | null,
  opts: CcxtStreamOptions = {},
): StreamSource {
  const exchange: ProExchange | null = injected !== undefined ? injected : buildProExchange();
  const stallMs = opts.stallMs ?? numEnv('MIDAS_STREAM_STALL_MS', 60_000);
  const retryMinMs = opts.retryMinMs ?? numEnv('MIDAS_STREAM_RETRY_MIN_MS', 1_000);
  const retryMaxMs = opts.retryMaxMs ?? numEnv('MIDAS_STREAM_RETRY_MAX_MS', 30_000);

  return {
    available: exchange !== null,

    start(channel, symbol, emit, onFatal) {
      if (!exchange) return () => {};
      const ex = exchange;
      let running = true;
      let failures = 0;
      let stalls = 0;

      /** Race one watch call against the stall watchdog. */
      const watching = <T>(p: Promise<T>): Promise<T> => {
        if (stallMs <= 0) return p;
        return new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => reject(new StreamStallError()), stallMs);
          timer.unref?.();
          // Both settlement branches are attached here, so a watch promise
          // abandoned by a stall can never surface an unhandled rejection.
          p.then(
            (v) => {
              clearTimeout(timer);
              resolve(v);
            },
            (err) => {
              clearTimeout(timer);
              reject(err);
            },
          );
        });
      };

      void (async () => {
        while (running) {
          try {
            if (channel === 'trades') {
              const trades = await watching(ex.watchTrades(symbol));
              failures = 0;
              stalls = 0;
              if (!running) break;
              for (const t of trades) {
                const price = n(t.price);
                const amount = n(t.amount);
                // Drop a trade lacking a finite price or amount rather than
                // emitting a fabricated 0 print under a live badge.
                if (price == null || amount == null) continue;
                emit({
                  price,
                  amount,
                  side: t.side === 'sell' ? 'sell' : 'buy',
                  timestamp: t.timestamp ?? Date.now(),
                });
              }
            } else if (channel === 'orderbook') {
              const ob = await watching(ex.watchOrderBook(symbol, 25));
              failures = 0;
              stalls = 0;
              if (!running) break;
              // Same rule for book levels: a row with no finite price/amount is
              // dropped, never zeroed into a fake 0-priced level.
              const levels = (rows: number[][]) =>
                rows.slice(0, 25).flatMap((r) => {
                  const price = n(r[0]);
                  const amount = n(r[1]);
                  return price == null || amount == null ? [] : [{ price, amount }];
                });
              emit({
                symbol,
                bids: levels(ob.bids),
                asks: levels(ob.asks),
                timestamp: ob.timestamp ?? Date.now(),
              });
            } else if (channel === 'ticker') {
              const t = await watching(ex.watchTicker(symbol));
              failures = 0;
              stalls = 0;
              if (!running) break;
              const price = n(t.last ?? t.close);
              // No usable price in the payload → emit nothing, not a $0 tick.
              if (price == null) continue;
              emit({ price, changePercent: n(t.percentage) ?? 0 });
            } else {
              return;
            }
          } catch (err) {
            if (!running) break;
            // A symbol the exchange does not list will never resolve — stop
            // instead of retrying forever (which hammers the exchange and the
            // operator's key). Transient errors (disconnect, temporary blip)
            // still back off and retry.
            if (isUnknownSymbol(err)) {
              running = false;
              // Permanent failure: tell the hub so it tears down this source
              // (freeing the global slot) instead of leaving a silent dead
              // entry that later subscribers would join and never hear from.
              onFatal?.(`No live ${channel} for ${symbol} — the exchange does not list it.`);
              break;
            }
            if (err instanceof StreamStallError) {
              // The watch parked past the stall window (a silently dead
              // upstream websocket — common on real venues). Drop the cached
              // subscription so the retry below re-subscribes from scratch.
              // A watch that ERRORS is at least talking, so only stalls
              // advance the streak that ends in onFatal.
              unwatch(ex, channel, symbol);
              stalls += 1;
              if (stalls >= MAX_CONSECUTIVE_STALLS) {
                running = false;
                onFatal?.(
                  `No live ${channel} for ${symbol} — the upstream feed went silent and every restart stalled.`,
                );
                break;
              }
            } else {
              stalls = 0;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, retryDelay(failures, retryMinMs, retryMaxMs)),
            );
            failures += 1;
          }
        }
      })();

      return () => {
        running = false;
        // Tear the exchange-side subscription + its per-symbol cache down. The
        // running=false above only exits our loop; without this ccxt keeps the
        // upstream subscription alive and appends to its cache forever, so
        // subscribe→unsubscribe over many symbols leaks connections and memory.
        unwatch(ex, channel, symbol);
      };
    },
  };
}
