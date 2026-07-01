import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OrderBook, OrderBookLevel } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { emitPricePick } from '@/lib/accountBus';
import { useStream } from '@/lib/stream';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const DISPLAY_LEVELS = 14;

function fmtBookPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtAmount(a: number): string {
  if (a >= 1000) return a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return a.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

interface Row {
  price: number;
  amount: number;
  cumulative: number;
}

/** Running cumulative size outward from the best price. */
function cumulate(levels: OrderBookLevel[]): Row[] {
  let sum = 0;
  return levels.map((l) => {
    sum += l.amount;
    return { price: l.price, amount: l.amount, cumulative: sum };
  });
}

export function OrderBookModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  // REST for instant first paint; the live WebSocket stream takes over once connected.
  const { data: fetched, error, loading, refresh } = useFetch(
    (signal) => api.orderbook(symbol as string, 25, signal),
    [symbol],
    { enabled: Boolean(symbol) },
  );

  const [live, setLive] = useState<OrderBook | null>(null);
  useEffect(() => setLive(null), [symbol]);
  useStream(
    'orderbook',
    symbol,
    useCallback((d: unknown) => setLive(d as OrderBook), []),
  );

  const data = live ?? fetched;

  const view = useMemo(() => {
    if (!data) return null;
    const bids = cumulate(data.bids.slice(0, DISPLAY_LEVELS));
    const asks = cumulate(data.asks.slice(0, DISPLAY_LEVELS));
    const max = Math.max(bids.at(-1)?.cumulative ?? 0, asks.at(-1)?.cumulative ?? 0, 1);
    const bestBid = data.bids[0]?.price ?? 0;
    const bestAsk = data.asks[0]?.price ?? 0;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
    const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
    const spreadPct = mid ? (spread / mid) * 100 : 0;
    return { bids, asks, max, mid, spread, spreadPct };
  }, [data]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} book`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!view) return <EmptyState>No order book for {symbol}.</EmptyState>;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="grid grid-cols-2 border-b border-term-border px-2 py-1 text-term-muted">
        <span>PRICE</span>
        <span className="text-right">SIZE</span>
      </div>

      {/* Asks — worst at top, best ask just above the spread. */}
      <div className="flex flex-1 flex-col justify-end overflow-hidden">
        {[...view.asks].reverse().map((r) => (
          <DomRow key={`a-${r.price}`} row={r} max={view.max} side="ask" link={panel.link} />
        ))}
      </div>

      {/* Spread / mid. */}
      <div className="flex items-center justify-between border-y border-term-border bg-term-header px-2 py-1">
        <span className="font-semibold tabular-nums text-term-text">{fmtBookPrice(view.mid)}</span>
        <span className="tabular-nums text-term-muted">
          spread {fmtBookPrice(view.spread)} ({view.spreadPct.toFixed(3)}%)
        </span>
      </div>

      {/* Bids — best bid just below the spread. */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {view.bids.map((r) => (
          <DomRow key={`b-${r.price}`} row={r} max={view.max} side="bid" link={panel.link} />
        ))}
      </div>
    </div>
  );
}

function DomRow({ row, max, side, link }: { row: Row; max: number; side: 'ask' | 'bid'; link?: string }) {
  const pct = max > 0 ? (row.cumulative / max) * 100 : 0;
  const bar = side === 'ask' ? 'rgba(239,77,86,0.16)' : 'rgba(38,194,129,0.16)';
  const priceColor = side === 'ask' ? 'text-term-down' : 'text-term-up';
  // When this book is in a link group, clicking a level sends the price to the
  // order ticket in the same group (open both via the Trade Desk template).
  const pick = link ? () => emitPricePick({ group: link, price: row.price }) : undefined;
  return (
    <div
      className={`relative grid grid-cols-2 px-2 py-[1.5px] tabular-nums ${
        pick ? 'no-drag cursor-pointer hover:bg-term-header/60' : ''
      }`}
      onClick={pick}
      title={pick ? 'Send this price to the linked order ticket' : undefined}
    >
      <div className="absolute inset-y-0 right-0" style={{ width: `${pct}%`, background: bar }} />
      <span className={`relative ${priceColor}`}>{fmtBookPrice(row.price)}</span>
      <span className="relative text-right text-term-text">{fmtAmount(row.amount)}</span>
    </div>
  );
}
