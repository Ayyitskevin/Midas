import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { rwiBoard, type RwiSort, type RwiBar } from '@/lib/rwi';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; period: number }[] = [
  { label: '14', period: 14 },
  { label: '8', period: 8 },
];

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: RwiSort;
  label: string;
  align: 'left' | 'right';
  sort: RwiSort;
  onSort: (c: RwiSort) => void;
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

export function RwiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 14
  const [sort, setSort] = useState<RwiSort>('rwi');
  const per = PERIODS[perIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })) as RwiBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as RwiBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? rwiBoard(data, sort, per.period) : []), [data, sort, per.period]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Random Walk Index.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Random Walk Index · trend vs noise · period {per.label}</span>
        <div className="ml-auto flex gap-1">
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPerIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === perIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
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
          <EmptyState>Not enough history to compute the RWI.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="rwi" label="RWI" align="right" sort={sort} onSort={setSort} />
                <SortHead col="high" label="HIGH" align="right" sort={sort} onSort={setSort} />
                <SortHead col="low" label="LOW" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">STATE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const upWins = r.dir === 'up';
                return (
                  <tr key={r.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 text-left">
                      <button
                        onClick={() => navigate(panel, r.symbol)}
                        className="no-drag text-term-text hover:text-term-amber"
                      >
                        {base(r.symbol)}
                      </button>
                    </td>
                    <td
                      className={`px-2 py-0.5 text-right font-semibold ${
                        upWins ? 'text-term-up' : 'text-term-down'
                      }`}
                    >
                      {r.rwi > 0 ? '+' : ''}
                      {r.rwi.toFixed(2)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${r.rwiHigh >= 1 ? 'text-term-up' : 'text-term-muted'}`}>
                      {r.rwiHigh.toFixed(2)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${r.rwiLow >= 1 ? 'text-term-down' : 'text-term-muted'}`}>
                      {r.rwiLow.toFixed(2)}
                    </td>
                    <td className="px-2 py-0.5 text-center">
                      {r.trending ? (
                        <span className={upWins ? 'text-term-up' : 'text-term-down'}>
                          {upWins ? '▲ trend' : '▼ trend'}
                        </span>
                      ) : (
                        <span className="text-term-dim">· range</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        RWI = displacement ÷ (ATR·√k) over k=2..{per.label} · ≥ 1 ={' '}
        <span className="text-term-up">▲ trend</span> / <span className="text-term-down">▼ trend</span>, &lt; 1 = range
      </div>
    </div>
  );
}
