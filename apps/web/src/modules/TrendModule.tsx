import { useMemo, useState } from 'react';
import type { Candle, Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { trendBoard, type TrendSort } from '@/lib/maTrend';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '2y';

const PERIODS: { label: string; period: number }[] = [
  { label: '50', period: 50 },
  { label: '200', period: 200 },
];

const signColor = (v: number) => (v > 0 ? 'text-term-up' : v < 0 ? 'text-term-down' : 'text-term-muted');
const fmtRun = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: TrendSort;
  label: string;
  align: 'left' | 'right';
  sort: TrendSort;
  onSort: (c: TrendSort) => void;
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

export function TrendModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 50
  const [sort, setSort] = useState<TrendSort>('run');
  const per = PERIODS[perIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, candles: h.candles }))
            .catch(() => ({ symbol: s, candles: [] as Candle[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? trendBoard(data, sort, per.period) : []), [data, sort, per.period]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to track MA trend.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">MA trend-persistence · close vs SMA{per.label}</span>
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
          <EmptyState>Not enough history for SMA{per.label}.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="run" label="RUN" align="right" sort={sort} onSort={setSort} />
                <SortHead col="dist" label="DIST%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="pctAbove" label="ABOVE%" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${signColor(r.run)}`}>{fmtRun(r.run)}</td>
                  <td className={`px-2 py-0.5 text-right ${signColor(r.dist)}`}>{fmtSignedPercent(r.dist, 1)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.pctAbove * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        RUN = consecutive closes <span className="text-term-up">above</span> /{' '}
        <span className="text-term-down">below</span> SMA{per.label} · DIST% = price vs SMA · ABOVE% = share of days above
      </div>
    </div>
  );
}
