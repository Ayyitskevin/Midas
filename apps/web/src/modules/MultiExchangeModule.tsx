import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact, fmtSignedPercent } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { SourceBadge } from '@/components/SourceInspector';
import { computeInspectedVenueArb } from '@/lib/clientArb';
import { isReceiptActionable } from '@/lib/receiptView';
import type { ModuleProps } from './types';

function fmtP(p: number | null): string {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function MultiExchangeModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.exchangeQuotes(symbol as string, signal),
    [symbol],
    { intervalMs: 5000, enabled: Boolean(symbol) },
  );

  const inspected = useMemo(
    () => computeInspectedVenueArb(symbol ?? 'unknown', data ?? []),
    [data, symbol],
  );
  const stats = useMemo(() => {
    const bestBid = inspected.row.bestBid?.value ?? null;
    const bestAsk = inspected.row.bestAsk?.value ?? null;
    if (bestBid === null && bestAsk === null) return null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
    const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    const spreadPct = spread != null && mid ? (spread / mid) * 100 : null;
    return { bestBid, bestAsk, spreadPct };
  }, [inspected]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} venues`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!data || data.length === 0) return <EmptyState>No venues for {symbol}.</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      {stats && (
        <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
          <span className="text-term-muted">{data.length} venues</span>
          {inspected.receipt && <SourceBadge receipt={inspected.receipt} compact />}
          <span className="tabular-nums">
            <span className={inspected.actionable ? 'text-term-up' : 'text-term-muted'}>{fmtP(stats.bestBid)}</span>
            <span className="text-term-dim"> / </span>
            <span className={inspected.actionable ? 'text-term-down' : 'text-term-muted'}>{fmtP(stats.bestAsk)}</span>
            {stats.spreadPct != null && (
              <span className="ml-2 text-term-muted">quote gap {stats.spreadPct.toFixed(3)}%</span>
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
              <th className="px-2 py-1 text-right font-normal">SOURCE</th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => {
              const rowActionable = isReceiptActionable(v.receipt);
              return (
              <tr key={v.exchange} className="border-b border-term-border/30 hover:bg-term-header/60">
                <td className="px-2 py-1 font-medium text-term-text">{v.exchange}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtP(v.price)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${rowActionable ? changeClass(v.changePercent) : 'text-term-muted'}`}>
                  {fmtSignedPercent(v.changePercent)}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    inspected.actionable && stats && v.bid === stats.bestBid ? 'font-semibold text-term-up' : 'text-term-muted'
                  }`}
                >
                  {fmtP(v.bid)}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    inspected.actionable && stats && v.ask === stats.bestAsk ? 'font-semibold text-term-down' : 'text-term-muted'
                  }`}
                >
                  {fmtP(v.ask)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtCompact(v.volume)}</td>
                <td className="px-2 py-1 text-right">
                  {v.receipt ? <SourceBadge receipt={v.receipt} compact /> : <span className="text-term-down">unknown</span>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
