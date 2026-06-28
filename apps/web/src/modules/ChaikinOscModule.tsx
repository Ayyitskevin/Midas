import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { choBoard, type ChoSort, type ChoBarColor, type ChoBar } from '@/lib/cho';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; fast: number; slow: number }[] = [
  { label: '3/10', fast: 3, slow: 10 },
  { label: '6/20', fast: 6, slow: 20 },
];

const choClass = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function BarCell({ bar }: { bar: ChoBarColor }) {
  if (bar === 'up') return <span className="text-term-up">▲ RISE</span>;
  return <span className="text-term-down">▼ FALL</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: ChoSort;
  label: string;
  align: 'left' | 'right';
  sort: ChoSort;
  onSort: (c: ChoSort) => void;
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

export function ChaikinOscModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 3/10
  const [sort, setSort] = useState<ChoSort>('cho');
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
              bars: h.candles.map((c) => ({
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
              })) as ChoBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as ChoBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? choBoard(data, sort, per.fast, per.slow) : []),
    [data, sort, per.fast, per.slow],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Chaikin Oscillator.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Chaikin Oscillator · {per.label}</span>
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
          <EmptyState>Not enough history for the Chaikin Oscillator.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="cho" label="CHO÷V" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">BAR</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${choClass(r.choNorm)}`}>
                    {r.choNorm >= 0 ? '+' : ''}
                    {r.choNorm.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <BarCell bar={r.bar} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Marc Chaikin Oscillator · EMA(ADL,3) − EMA(ADL,10) · <span className="text-term-up">&gt; 0 accumulation</span> /{' '}
        <span className="text-term-down">&lt; 0 distribution</span> · BAR = rising/falling vs prior · ÷ avg volume so
        symbols compare · sorts most bullish first
      </div>
    </div>
  );
}
