import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { rangeBoard, type RangeSort } from '@/lib/range';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtExp = (v: number) => `${v.toFixed(2)}×`;
const expColor = (v: number, isWide: boolean, isNR: boolean) =>
  isWide ? 'text-term-amber' : isNR ? 'text-term-accent' : v >= 1 ? 'text-term-text' : 'text-term-muted';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: RangeSort;
  label: string;
  align: 'left' | 'right';
  sort: RangeSort;
  onSort: (c: RangeSort) => void;
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

export function RangeModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
  const [sort, setSort] = useState<RangeSort>('expansion');
  const tf = TIMEFRAMES[tfIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
            }))
            .catch(() => ({ symbol: s, bars: [] as { high: number; low: number; close: number }[] })),
        ),
      ),
    [fetchSyms.join(','), tf.interval, tf.range],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? rangeBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to see range expansion.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Range expansion · true range vs trailing avg · {tf.label}</span>
        <div className="ml-auto flex gap-1">
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t.label}
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
          <EmptyState>Not enough history to measure range.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="rangePct" label="RNG%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="avgRangePct" label="AVG%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="expansion" label="EXP" align="right" sort={sort} onSort={setSort} />
                <SortHead col="nrRank" label="NR" align="right" sort={sort} onSort={setSort} />
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
                  <td className="px-2 py-0.5 text-right text-term-text">{fmtPct(r.rangePct)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{fmtPct(r.avgRangePct)}</td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${expColor(r.expansion, r.isWide, r.isNR)}`}>
                    {fmtExp(r.expansion)}
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    <span className="text-term-muted">
                      {r.nrRank}/{r.lookback}
                    </span>
                    {r.isNR && <span className="ml-1 text-term-accent">NR</span>}
                    {r.isWide && <span className="ml-1 text-term-amber">WIDE</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        True range vs trailing avg · EXP = today ÷ avg (<span className="text-term-amber">&gt;1 expanding</span> /{' '}
        <span className="text-term-accent">&lt;1 coiling</span>) · NR = rank in last 7 (1 = narrowest, NR7 setup) · WIDE = widest
      </div>
    </div>
  );
}
