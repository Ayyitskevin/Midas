import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { shapeBoard, type ShapeSort } from '@/lib/returnShape';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const skewColor = (v: number) => (v > 0.1 ? 'text-term-up' : v < -0.1 ? 'text-term-down' : 'text-term-muted');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: ShapeSort;
  label: string;
  align: 'left' | 'right';
  sort: ShapeSort;
  onSort: (c: ShapeSort) => void;
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

export function ShapeModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<ShapeSort>('kurtosis');

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, '1d', '1y', signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? shapeBoard(data, sort) : []), [data, sort]);
  const maxAbsKurt = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.kurtosis))), [rows]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to scan return shape (skew & fat tails).</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">return shape · daily · 1Y</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to measure return shape.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="skew" label="SKEW" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">KURT (fat tails →)</th>
                <SortHead col="kurtosis" label="K" align="right" sort={sort} onSort={setSort} />
                <SortHead col="vol" label="VOL" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${skewColor(r.skew)}`}>
                    {r.skew >= 0 ? '+' : ''}
                    {r.skew.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5">
                    <div className="relative h-3 w-full rounded-sm bg-term-bg/60">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${Math.min(100, (Math.max(0, r.kurtosis) / maxAbsKurt) * 100)}%`,
                          background: r.kurtosis >= 1 ? 'rgba(255,176,0,0.4)' : 'rgba(122,127,135,0.3)',
                        }}
                      />
                    </div>
                  </td>
                  <td className={`px-2 py-0.5 text-right ${r.kurtosis >= 1 ? 'text-term-amber' : 'text-term-muted'}`}>
                    {r.kurtosis.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.vol * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        skew <span className="text-term-down">&lt;0</span> = crash-prone left tail · excess kurtosis{' '}
        <span className="text-term-amber">&gt;0</span> = fatter-than-normal tails
      </div>
    </div>
  );
}
