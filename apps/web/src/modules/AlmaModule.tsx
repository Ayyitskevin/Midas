import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { almaBoard, type AlmaSort, type AlmaDir } from '@/lib/alma';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const OFFSET = 0.85;
const SIGMA = 6;
const WINDOWS: { label: string; window: number }[] = [
  { label: '9', window: 9 },
  { label: '21', window: 21 },
];

const signClass = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function DirCell({ dir }: { dir: AlmaDir }) {
  if (dir === 'up') return <span className="text-term-up">▲ RISE</span>;
  if (dir === 'down') return <span className="text-term-down">▼ FALL</span>;
  return <span className="text-term-dim">· FLAT</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: AlmaSort;
  label: string;
  align: 'left' | 'right';
  sort: AlmaSort;
  onSort: (c: AlmaSort) => void;
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

export function AlmaModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [winIdx, setWinIdx] = useState(0); // default window 9
  const [sort, setSort] = useState<AlmaSort>('slope');
  const win = WINDOWS[winIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? almaBoard(data, sort, win.window, OFFSET, SIGMA) : []),
    [data, sort, win.window],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Arnaud Legoux Moving Average.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Arnaud Legoux MA · N {win.label} / off 0.85 / σ 6</span>
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setWinIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === winIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history for the Arnaud Legoux Moving Average.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="dist" label="DIST%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="SLOPE%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">DIR</th>
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
                  <td className={`px-2 py-0.5 text-right ${signClass(r.distPct)}`}>{r.distPct.toFixed(2)}</td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${signClass(r.slopePct)}`}>
                    {r.slopePct.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <DirCell dir={r.dir} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Arnaud Legoux MA · Gaussian-weighted low-lag average (peak slid toward recent bars) · DIST% = price vs line,
        SLOPE% = line trend · sorts strongest rising first
      </div>
    </div>
  );
}
