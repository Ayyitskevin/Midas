import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { FundingVenuePoint } from '@midas/shared';
import type { ModuleProps } from './types';

/** Funding fraction → signed percent, e.g. 0.0001 → "+0.0100%". */
function fmtPct(rate: number | null): string {
  if (rate == null) return '—';
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(4)}%`;
}

/** Spread in basis points, e.g. 3.2 → "3.20 bp". */
function fmtBps(bps: number | null): string {
  if (bps == null) return '—';
  return `${bps.toFixed(2)} bp`;
}

/** Full per-venue breakdown for the row's hover title. */
function venuesTitle(venues: FundingVenuePoint[]): string {
  return venues.map((v) => `${v.exchange} ${fmtPct(v.fundingRate)}`).join('  ·  ');
}

export function FundingDispersionModule({ panel }: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.fundingDispersion('USDT', 20, signal),
    [],
    { intervalMs: 20_000 },
  );

  // The server already ranks widest-spread first — the funding-arb signal.
  const rows = data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">FUNDING DISPERSION</span>
        <span className="text-term-dim">cross-venue Δfund · USDT · 8h</span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading dispersion" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && rows.length === 0 && (
          <EmptyState>No cross-venue funding spread — a single-venue set, or spot-only pairs.</EmptyState>
        )}
        {rows.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-right font-normal">Δ</th>
                <th className="px-2 py-1 text-right font-normal" title="Cheapest-funded venue — long here">
                  LONG
                </th>
                <th className="px-2 py-1 text-right font-normal" title="Dearest-funded venue — short here">
                  SHORT
                </th>
                <th className="px-2 py-1 text-right font-normal">MEAN</th>
                <th className="px-2 py-1 text-right font-normal">OI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  className="border-b border-term-border/30 hover:bg-term-header/60"
                  title={venuesTitle(r.venues)}
                >
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, r.symbol)}
                    >
                      {r.symbol}
                    </button>
                    <span className="ml-1 text-term-dim">·{r.venues.length}</span>
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-term-amber">
                    {fmtBps(r.spreadBps)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <span className="text-term-up">{fmtPct(r.minRate)}</span>
                    <span className="ml-1 text-term-dim">{r.lowVenue ?? ''}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <span className="text-term-down">{fmtPct(r.maxRate)}</span>
                    <span className="ml-1 text-term-dim">{r.highVenue ?? ''}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtPct(r.meanRate)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                    {r.totalOiValue != null ? `$${fmtCompact(r.totalOiValue)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Δ = cross-venue funding spread (bp) · <span className="text-term-up">long</span> the cheapest-funded venue,{' '}
        <span className="text-term-down">short</span> the dearest · OI = aggregate open interest
      </div>
    </div>
  );
}
