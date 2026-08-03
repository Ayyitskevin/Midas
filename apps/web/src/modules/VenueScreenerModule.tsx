import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { BoardMetaBadge, BoardMetaNote } from '@/components/BoardMeta';
import { CROSS_VENUE_SCREEN_SORTS, type CrossVenueScreenSort } from '@midas/shared';
import { basisLabel, fmtDispersionBps, venuesTitle } from '@/lib/venueScreen';
import type { ModuleProps } from './types';

const SORT_LABELS: Record<CrossVenueScreenSort, string> = {
  volume: 'VOL',
  change: 'CHG',
  price: 'PRICE',
  venues: 'VENUES',
  dispersion: 'DISP',
};

export function VenueScreenerModule({ panel }: ModuleProps) {
  const [sort, setSort] = useState<CrossVenueScreenSort>('volume');
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.venueScreener('USDT', sort, 40, signal),
    [sort],
    { intervalMs: 20_000 },
  );

  const rows = data?.rows ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">CROSS-VENUE SCREENER</span>
        {data ? (
          <BoardMetaBadge meta={data.meta} />
        ) : (
          <span className="text-term-dim">all configured venues · USDT</span>
        )}
      </div>
      {data && <BoardMetaNote meta={data.meta} />}

      <div className="flex flex-wrap gap-1 border-b border-term-border px-2 py-1 text-2xs">
        {CROSS_VENUE_SCREEN_SORTS.map((key) => (
          <button
            key={key}
            className={`no-drag px-1 ${sort === key ? 'text-term-amber' : 'text-term-dim hover:text-term-text'}`}
            onClick={() => setSort(key)}
          >
            {SORT_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading cross-venue screener" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && rows.length === 0 && <EmptyState>No venue reported a usable ticker set.</EmptyState>}
        {rows.length > 0 && (
          <table className="w-full text-2xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">CHG%</th>
                <th className="px-2 py-1 text-right font-normal" title="Summed across venues — reported volume, not a verified total">
                  VOL
                </th>
                <th className="px-2 py-1 text-right font-normal" title="How many configured venues quote this symbol">
                  VEN
                </th>
                <th className="px-2 py-1 text-right font-normal" title="Price disagreement across venues, basis points">
                  DISP
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.symbol} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-0.5">
                    <button
                      className="no-drag text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, row.symbol)}
                    >
                      {row.symbol}
                    </button>
                  </td>
                  <td
                    className="px-2 py-0.5 text-right tabular-nums"
                    // The basis is on the price cell, not buried in a footnote:
                    // a median or single-venue figure is a different claim from
                    // a volume-weighted one.
                    title={basisLabel(row.basis)}
                  >
                    {row.price === null ? '—' : fmtPrice(row.price)}
                    {row.basis !== 'volume-weighted' && row.price !== null && (
                      <span className="text-term-dim">*</span>
                    )}
                  </td>
                  <td
                    className={`px-2 py-0.5 text-right tabular-nums ${
                      row.changePercent === null
                        ? 'text-term-dim'
                        : row.changePercent >= 0
                          ? 'text-term-up'
                          : 'text-term-down'
                    }`}
                  >
                    {row.changePercent === null ? '—' : `${row.changePercent.toFixed(2)}%`}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums text-term-muted">
                    {row.totalQuoteVolume === null ? '—' : `$${fmtCompact(row.totalQuoteVolume)}`}
                  </td>
                  <td
                    className={`px-2 py-0.5 text-right tabular-nums ${
                      row.venueCount === 1 ? 'text-term-amber' : 'text-term-muted'
                    }`}
                    title={venuesTitle(row.venues)}
                  >
                    {row.venueCount}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums text-term-dim">
                    {fmtDispersionBps(row.priceDispersionBps)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs leading-snug text-term-dim">
        * price is a median or single-venue figure, not volume-weighted. Volume is summed
        exchange-reported turnover — a scale signal, not a verified total.
      </div>
    </div>
  );
}
