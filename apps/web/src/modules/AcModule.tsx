import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { acBoard, type AcSort, type AcBarColor, type AcBar } from '@/lib/ac';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Williams' signal SMA of the AO is fixed at 5; presets vary the AO fast/slow.
const SIGNAL = 5;
const PERIODS: { label: string; fast: number; slow: number }[] = [
  { label: '5/34', fast: 5, slow: 34 },
  { label: '8/55', fast: 8, slow: 55 },
];

const acClass = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function BarCell({ bar }: { bar: AcBarColor }) {
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
  col: AcSort;
  label: string;
  align: 'left' | 'right';
  sort: AcSort;
  onSort: (c: AcSort) => void;
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

export function AcModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 5/34
  const [sort, setSort] = useState<AcSort>('ac');
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
              bars: h.candles.map((c) => ({ high: c.high, low: c.low })) as AcBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as AcBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? acBoard(data, sort, per.fast, per.slow, SIGNAL) : []),
    [data, sort, per.fast, per.slow],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Accelerator Oscillator.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Accelerator Oscillator · {per.label}</span>
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
          <EmptyState>Not enough history for the Accelerator Oscillator.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="ac" label="AC%" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${acClass(r.acPct)}`}>
                    {r.acPct >= 0 ? '+' : ''}
                    {r.acPct.toFixed(2)}
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
        Bill Williams Accelerator Oscillator · AO − SMA(AO,5) · acceleration of momentum · BAR ={' '}
        <span className="text-term-up">green rising</span> / <span className="text-term-down">red falling</span> (buy
        green, sell red) · sorts highest AC% first
      </div>
    </div>
  );
}
