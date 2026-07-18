import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { VenueOiPoint } from '@midas/shared';
import type { ModuleProps } from './types';

/** A 0..1 share as a whole-percent, e.g. 0.62 → "62%". */
function fmtShare(share: number | null): string {
  if (share == null) return '—';
  return `${(share * 100).toFixed(0)}%`;
}

/** Herfindahl (0..1) as a 0–100 concentration index. */
function fmtConc(hhi: number | null): string {
  if (hhi == null) return '—';
  return (hhi * 100).toFixed(0);
}

/** Colour the top-venue share by how crowded it is (venue-risk cue). */
function shareClass(share: number | null): string {
  if (share == null) return 'text-term-dim';
  if (share >= 0.8) return 'text-term-down'; // one venue owns it
  if (share >= 0.6) return 'text-term-amber';
  return 'text-term-muted';
}

/** Full per-venue OI breakdown for the row's hover title. */
function venuesTitle(venues: VenueOiPoint[]): string {
  return venues.map((v) => `${v.exchange} $${fmtCompact(v.openInterestValue)} (${fmtShare(v.share)})`).join('  ·  ');
}

export function OiConcentrationModule({ panel }: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.oiConcentration('USDT', 20, signal),
    [],
    { intervalMs: 20_000 },
  );

  // The server ranks biggest total OI first — the markets that matter.
  const rows = data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">OI BY VENUE</span>
        <span className="text-term-dim">cross-venue crowding · USDT</span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading open interest" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && rows.length === 0 && <EmptyState>No open interest reported across venues.</EmptyState>}
        {rows.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-right font-normal">OI</th>
                <th className="px-2 py-1 text-right font-normal" title="Venue holding the most OI + its share">
                  TOP
                </th>
                <th className="px-2 py-1 text-right font-normal" title="Herfindahl concentration index (0–100)">
                  CONC
                </th>
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
                    <span className="ml-1 text-term-dim">·{r.venueCount}</span>
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-term-text">
                    ${fmtCompact(r.totalOiValue)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <span className={shareClass(r.topVenueShare)}>{fmtShare(r.topVenueShare)}</span>
                    <span className="ml-1 text-term-dim">{r.topVenue ?? ''}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtConc(r.herfindahl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        OI = aggregate open interest across venues · TOP = venue with the most OI + its share (
        <span className="text-term-amber">amber</span>/<span className="text-term-down">red</span> = crowded) · CONC =
        Herfindahl index (0–100; 100 = all on one venue)
      </div>
    </div>
  );
}
