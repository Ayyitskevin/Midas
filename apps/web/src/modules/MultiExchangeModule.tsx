import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact, fmtSignedPercent } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

function fmtP(p: number | null): string {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function MultiExchangeModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading } = useFetch(
    (signal) => api.exchangeQuotes(symbol as string, signal),
    [symbol],
    { intervalMs: 5000, enabled: Boolean(symbol) },
  );

  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    const bids = data.map((v) => v.bid).filter((b): b is number => b != null);
    const asks = data.map((v) => v.ask).filter((a): a is number => a != null);
    const bestBid = bids.length ? Math.max(...bids) : null;
    const bestAsk = asks.length ? Math.min(...asks) : null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
    const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    const spreadPct = spread != null && mid ? (spread / mid) * 100 : null;
    return { bestBid, bestAsk, spreadPct };
  }, [data]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} venues`} />;
  if (error && !data) return <ErrorMsg message={error} />;
  if (!data || data.length === 0) return <EmptyState>No venues for {symbol}.</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      {stats && (
        <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
          <span className="text-term-muted">{data.length} venues</span>
          <span className="tabular-nums">
            <span className="text-term-up">{fmtP(stats.bestBid)}</span>
            <span className="text-term-dim"> / </span>
            <span className="text-term-down">{fmtP(stats.bestAsk)}</span>
            {stats.spreadPct != null && (
              <span className="ml-2 text-term-muted">arb {stats.spreadPct.toFixed(3)}%</span>
            )}
          </span>
        </div>
      )}
      <div className="scroll-term flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel">
            <tr className="text-2xs text-term-muted">
              <th className="px-2 py-1 text-left font-normal">VENUE</th>
              <th className="px-2 py-1 text-right font-normal">LAST</th>
              <th className="px-2 py-1 text-right font-normal">CHG%</th>
              <th className="px-2 py-1 text-right font-normal">BID</th>
              <th className="px-2 py-1 text-right font-normal">ASK</th>
              <th className="px-2 py-1 text-right font-normal">VOL</th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => (
              <tr key={v.exchange} className="border-b border-term-border/30 hover:bg-term-header/60">
                <td className="px-2 py-1 font-medium text-term-text">{v.exchange}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtP(v.price)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${changeClass(v.changePercent)}`}>
                  {fmtSignedPercent(v.changePercent)}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    stats && v.bid === stats.bestBid ? 'font-semibold text-term-up' : 'text-term-muted'
                  }`}
                >
                  {fmtP(v.bid)}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    stats && v.ask === stats.bestAsk ? 'font-semibold text-term-down' : 'text-term-muted'
                  }`}
                >
                  {fmtP(v.ask)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtCompact(v.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
