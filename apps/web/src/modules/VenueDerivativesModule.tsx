import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact } from '@/lib/format';
import { summarizeVenueDerivatives } from '@/lib/venueDerivatives';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

/** Funding fraction → signed percent, e.g. 0.0001 → "+0.0100%". */
function fmtFunding(r: number | null): string {
  if (r == null) return '—';
  return `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`;
}

function fmtMark(p: number | null): string {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtNextFunding(t: number | null): string {
  if (t == null) return '—';
  const hrs = (t - Date.now()) / 3_600_000;
  if (hrs <= 0) return 'now';
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  return `${hrs.toFixed(1)}h`;
}

export function VenueDerivativesModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.venueDerivatives(symbol as string, signal),
    [symbol],
    { intervalMs: 8000, enabled: Boolean(symbol) },
  );

  const stats = useMemo(() => (data ? summarizeVenueDerivatives(data) : null), [data]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} venues`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!data || data.length === 0)
    return <EmptyState>No perp venues for {symbol} (a spot-only pair, or no derivatives).</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      {stats && (
        <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
          <span className="text-term-muted">
            {stats.venues} venues · OI ${fmtCompact(stats.totalOi)}
          </span>
          {stats.spread != null && (
            <span className="tabular-nums text-term-muted" title="Funding spread across venues (long the cheapest, short the dearest)">
              Δfund <span className="text-term-amber">{(stats.spread * 100).toFixed(4)}%</span>
            </span>
          )}
        </div>
      )}
      <div className="scroll-term flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel">
            <tr className="text-2xs text-term-muted">
              <th className="px-2 py-1 text-left font-normal">VENUE</th>
              <th className="px-2 py-1 text-right font-normal">FUND%</th>
              <th className="px-2 py-1 text-right font-normal">OI</th>
              <th className="px-2 py-1 text-right font-normal">MARK</th>
              <th className="px-2 py-1 text-right font-normal">NEXT</th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => {
              // Highlight the funding extremes — the arb legs (cheapest long / dearest long).
              const isMin = stats?.minVenue === v.exchange && stats?.spread != null && stats.spread > 0;
              const isMax = stats?.maxVenue === v.exchange && stats?.spread != null && stats.spread > 0;
              const fundCls = isMin
                ? 'font-semibold text-term-up'
                : isMax
                  ? 'font-semibold text-term-down'
                  : 'text-term-muted';
              return (
                <tr key={v.exchange} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1 font-medium text-term-text">{v.exchange}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${fundCls}`}>{fmtFunding(v.fundingRate)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                    {v.openInterestValue != null ? `$${fmtCompact(v.openInterestValue)}` : '—'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtMark(v.markPrice)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-dim">{fmtNextFunding(v.nextFundingTime)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Funding &amp; OI for {symbol} across venues · <span className="text-term-up">green</span> = cheapest to long /{' '}
        <span className="text-term-down">red</span> = dearest · Δfund = cross-venue funding spread (arb signal)
      </div>
    </div>
  );
}
