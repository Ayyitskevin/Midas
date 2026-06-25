import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { computeArb, type VenueLevel } from '@/lib/arb';
import { Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className="font-mono text-sm text-term-text">{value}</span>
      {hint && <span className="text-2xs text-term-muted">{hint}</span>}
    </div>
  );
}

const pct3 = (v: number | null): string => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`);

export function ArbModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.exchangeQuotes(symbol!, signal),
    [symbol],
    { intervalMs: 5000, enabled: !!symbol },
  );

  if (!symbol) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Open with a symbol — e.g. <span className="text-term-amber">BTC/USDT ARB</span>.
      </div>
    );
  }
  if (loading && !data) return <Loading label="Loading venues" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  const venues = data ?? [];
  if (venues.length === 0) {
    return <div className="p-3 text-xs text-term-muted">No venue quotes for {symbol}.</div>;
  }

  const levels: VenueLevel[] = venues.map((q) => ({ exchange: q.exchange, bid: q.bid, ask: q.ask, price: q.price }));
  const arb = computeArb(levels);
  const sorted = [...venues].sort((a, b) => b.price - a.price);

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div
        className={`rounded-sm border px-3 py-2 ${
          arb.crossed ? 'border-term-up/40 bg-term-up/10' : 'border-term-border bg-term-panel/40'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-2xs uppercase tracking-wide text-term-dim">Best cross-venue spread</span>
          {arb.crossed && (
            <span className="rounded-sm bg-term-up/20 px-1.5 py-0.5 text-2xs font-semibold uppercase text-term-up">
              Arb
            </span>
          )}
        </div>
        <div className={`font-mono text-xl ${arb.spreadPct != null ? changeClass(arb.spreadPct) : 'text-term-text'}`}>
          {pct3(arb.spreadPct)}
        </div>
        {arb.bestAsk && arb.bestBid && (
          <div className="text-2xs text-term-muted">
            Buy <span className="text-term-accent">{arb.bestAsk.exchange}</span> @ {fmtPrice(arb.bestAsk.value)} · Sell{' '}
            <span className="text-term-up">{arb.bestBid.exchange}</span> @ {fmtPrice(arb.bestBid.value)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Venues" value={arb.venues} />
        <Stat
          label="Price dispersion"
          value={pct3(arb.dispersionPct)}
          hint={
            arb.priceMin != null && arb.priceMax != null
              ? `${fmtPrice(arb.priceMin)}–${fmtPrice(arb.priceMax)}`
              : undefined
          }
        />
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-2xs text-term-muted">
            <th className="px-2 py-1 text-left font-normal">VENUE</th>
            <th className="px-2 py-1 text-right font-normal">BID</th>
            <th className="px-2 py-1 text-right font-normal">ASK</th>
            <th className="px-2 py-1 text-right font-normal">LAST</th>
            <th className="px-2 py-1 text-right font-normal">24H</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((q) => {
            const isBuy = arb.bestAsk?.exchange === q.exchange;
            const isSell = arb.bestBid?.exchange === q.exchange;
            return (
              <tr key={q.exchange} className="border-b border-term-border/30">
                <td className="px-2 py-1 text-term-text">{q.exchange}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${isSell ? 'font-semibold text-term-up' : ''}`}>
                  {q.bid != null ? fmtPrice(q.bid) : '—'}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${isBuy ? 'font-semibold text-term-accent' : ''}`}>
                  {q.ask != null ? fmtPrice(q.ask) : '—'}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtPrice(q.price)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${changeClass(q.changePercent)}`}>
                  {fmtSignedPercent(q.changePercent)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Gross of fees &amp; transfer. A real arb must clear taker fees on both legs (and withdrawal). Highlighted: best
        bid (sell) and best ask (buy).
      </p>
    </div>
  );
}
