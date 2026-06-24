import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact, fmtPrice } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { annualizedFundingPct, sortFundingRows, type FundingSortKey } from '@/lib/funding';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

/** Format a funding rate (fraction) as a signed percent. */
function fmtPct(rate: number | null, decimals: number): string {
  if (rate == null) return '—';
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(decimals)}%`;
}

/** Format an annualized percent (already in percent units). */
function fmtAnnual(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** Time remaining until the next funding settlement. */
function untilNext(ms: number | null): string {
  if (ms == null) return '—';
  const d = ms - Date.now();
  if (d <= 0) return 'now';
  const h = Math.floor(d / 3_600_000);
  const m = Math.floor((d % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

export function FundingBoardModule({ panel }: ModuleProps) {
  const [sortKey, setSortKey] = useState<FundingSortKey>('funding');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const { data, error, loading, refresh } = useFetch((signal) => api.funding('USDT', 30, signal), [], {
    intervalMs: 15_000,
  });

  const rows = useMemo(() => (data ? sortFundingRows(data, sortKey, dir) : []), [data, sortKey, dir]);

  const sortBy = (key: FundingSortKey) => {
    if (key === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: FundingSortKey) => (key === sortKey ? (dir === 'desc' ? ' ▾' : ' ▴') : '');
  const th = (key: FundingSortKey | null, label: string, align: string) => (
    <th className={`px-2 py-1 font-normal ${align}`}>
      {key ? (
        <button className="no-drag hover:text-term-text" onClick={() => sortBy(key)}>
          {label}
          {arrow(key)}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">FUNDING RATES</span>
        <span className="text-term-dim">perps · USDT · 8h</span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading funding" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && data.length === 0 && <EmptyState>No perp funding available.</EmptyState>}
        {data && data.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                {th('symbol', 'SYMBOL', 'text-left')}
                {th('funding', 'FUND', 'text-right')}
                {th(null, 'FUND/yr', 'text-right')}
                {th(null, 'NEXT', 'text-right')}
                {th(null, 'MARK', 'text-right')}
                {th('oi', 'OI', 'text-right')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, r.symbol)}
                    >
                      {r.symbol}
                    </button>
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.fundingRate)}`}>
                    {fmtPct(r.fundingRate, 4)}
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.fundingRate)}`}>
                    {fmtAnnual(annualizedFundingPct(r.fundingRate))}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                    {untilNext(r.nextFundingTime)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.markPrice != null ? fmtPrice(r.markPrice) : '—'}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                    ${fmtCompact(r.openInterestValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
