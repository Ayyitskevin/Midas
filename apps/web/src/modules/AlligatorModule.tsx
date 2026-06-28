import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { alligatorBoard, type AlligatorSort, type GatorState, type AlligatorBar } from '@/lib/alligator';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const spreadClass = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function StateCell({ state }: { state: GatorState }) {
  if (state === 'up') return <span className="text-term-up">FEED ↑</span>;
  if (state === 'down') return <span className="text-term-down">FEED ↓</span>;
  return <span className="text-term-dim">SLEEP</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: AlligatorSort;
  label: string;
  align: 'left' | 'right';
  sort: AlligatorSort;
  onSort: (c: AlligatorSort) => void;
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

export function AlligatorModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<AlligatorSort>('spread');

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low })) as AlligatorBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as AlligatorBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? alligatorBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Williams Alligator.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Williams Alligator · Jaw 13 / Teeth 8 / Lips 5</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history for the Williams Alligator.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">STATE</th>
                <SortHead col="spread" label="SPREAD%" align="right" sort={sort} onSort={setSort} />
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
                  <td className="px-2 py-0.5 text-left font-semibold">
                    <StateCell state={r.state} />
                  </td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${spreadClass(r.spreadPct)}`}>
                    {r.spreadPct >= 0 ? '+' : ''}
                    {r.spreadPct.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Bill Williams Alligator · 3 displaced smoothed MAs of the median · lines fanned & ordered ={' '}
        <span className="text-term-up">feeding</span> (trend), intertwined = sleeping (range) · SPREAD% = Lips − Jaw ·
        sorts strongest up-fan first
      </div>
    </div>
  );
}
