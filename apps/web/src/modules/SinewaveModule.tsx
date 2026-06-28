import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { sinewaveBoard, type SinewaveSort, type SinewaveDir } from '@/lib/sinewave';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const dirClass = (d: SinewaveDir) => (d === 'bull' ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: SinewaveSort;
  label: string;
  align: 'left' | 'right';
  sort: SinewaveSort;
  onSort: (c: SinewaveSort) => void;
}) {
  return (
    <th className={`px-2 py-1 font-normal ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}

export function SinewaveModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<SinewaveSort>('lead');

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
            }))
            .catch(() => ({ symbol: s, bars: [] as { high: number; low: number; close: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? sinewaveBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Sine Wave.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Ehlers Sinewave · dominant-cycle phase</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history for the Sine Wave.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">DIR</th>
                <th className="px-2 py-1 text-right font-normal text-term-muted">SINE</th>
                <SortHead col="lead" label="LEAD" align="right" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-left">
                    <button
                      onClick={() => navigate(panel, r.symbol)}
                      className="no-drag text-term-text hover:text-term-amber"
                    >
                      {base(r.symbol)}
                    </button>
                  </td>
                  <td className="px-2 py-0.5 text-left">
                    {r.cross !== 'none' && <span className="text-term-amber">✦ </span>}
                    <span className={dirClass(r.dir)}>{r.dir === 'bull' ? 'UP' : 'DOWN'}</span>
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.sine.toFixed(2)}</td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${dirClass(r.dir)}`}>
                    {r.leadSine.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Sine &amp; LeadSine cycle lines (−1…1) ·{' '}
        <span className="text-term-up">LeadSine above Sine = cyclic up</span> ·{' '}
        <span className="text-term-amber">✦</span> fresh cross · lines flatten in trends
      </div>
    </div>
  );
}
