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

interface ProExchange {
  watchTrades(symbol: string): Promise<
    Array<{ price?: number; amount?: number; side?: string; timestamp?: number }>
  >;
  watchOrderBook(
    symbol: string,
    limit?: number,
  ): Promise<{ bids: number[][]; asks: number[][]; timestamp?: number }>;
  watchTicker(symbol: string): Promise<{ last?: number; close?: number; percentage?: number }>;
  close?(): Promise<void>;
}

function n(v: number | undefined | null): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface StreamSource {
  start(channel: string, symbol: string, emit: Emit): () => void;
}

export function createCcxtStreamSource(): StreamSource {
  const id = (process.env.MIDAS_CCXT_EXCHANGE ?? 'binance').toLowerCase();
  const proNs = (ccxt as unknown as {
    pro: Record<string, new (config: object) => ProExchange>;
  }).pro;
  const Ctor = proNs?.[id];
  const exchange: ProExchange | null =
    typeof Ctor === 'function' ? new Ctor({ enableRateLimit: true }) : null;

  return {
    start(channel, symbol, emit) {
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
          } catch {
            if (!running) break;
            // Back off on transient errors (unsupported symbol, disconnect, …).
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      })();

      return () => {
        running = false;
      };
    },
  };
}
