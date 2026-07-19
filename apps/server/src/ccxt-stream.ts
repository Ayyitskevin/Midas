import * as ccxt from 'ccxt';

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

function n(v: number | undefined | null): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface StreamSource {
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

/** Build the CCXT Pro exchange for the configured id, or null when unavailable. */
function buildProExchange(): ProExchange | null {
  const id = (process.env.MIDAS_CCXT_EXCHANGE ?? 'binance').toLowerCase();
  const proNs = (ccxt as unknown as {
    pro: Record<string, new (config: object) => ProExchange>;
  }).pro;
  const Ctor = proNs?.[id];
  return typeof Ctor === 'function' ? new Ctor({ enableRateLimit: true }) : null;
}

/**
 * @param injected test seam — pass a fake ProExchange (or null); omit in
 *   production to build the live exchange from MIDAS_CCXT_EXCHANGE.
 */
export function createCcxtStreamSource(injected?: ProExchange | null): StreamSource {
  const exchange: ProExchange | null = injected !== undefined ? injected : buildProExchange();

  return {
    start(channel, symbol, emit, onFatal) {
      if (!exchange) return () => {};
      const ex = exchange;
      let running = true;

      void (async () => {
        while (running) {
          try {
            if (channel === 'trades') {
              const trades = await ex.watchTrades(symbol);
              if (!running) break;
              for (const t of trades) {
                emit({
                  price: n(t.price),
                  amount: n(t.amount),
                  side: t.side === 'sell' ? 'sell' : 'buy',
                  timestamp: t.timestamp ?? Date.now(),
                });
              }
            } else if (channel === 'orderbook') {
              const ob = await ex.watchOrderBook(symbol, 25);
              if (!running) break;
              const levels = (rows: number[][]) =>
                rows.slice(0, 25).map((r) => ({ price: n(r[0]), amount: n(r[1]) }));
              emit({
                symbol,
                bids: levels(ob.bids),
                asks: levels(ob.asks),
                timestamp: ob.timestamp ?? Date.now(),
              });
            } else if (channel === 'ticker') {
              const t = await ex.watchTicker(symbol);
              if (!running) break;
              emit({ price: n(t.last ?? t.close), changePercent: n(t.percentage) });
            } else {
              return;
            }
          } catch (err) {
            if (!running) break;
            // A symbol the exchange does not list will never resolve — stop
            // instead of retrying every second forever (which hammers the
            // exchange and the operator's key). Transient errors (disconnect,
            // temporary blip) still back off and retry.
            if (isUnknownSymbol(err)) {
              running = false;
              // Permanent failure: tell the hub so it tears down this source
              // (freeing the global slot) instead of leaving a silent dead
              // entry that later subscribers would join and never hear from.
              onFatal?.(`No live ${channel} for ${symbol} — the exchange does not list it.`);
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
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
