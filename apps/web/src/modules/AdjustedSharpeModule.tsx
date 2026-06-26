import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { adjustedSharpeBoard, type AdjSharpeSort } from '@/lib/adjustedSharpe';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const PERIODS_PER_YEAR = 365;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

const signColor = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: AdjSharpeSort;
  label: string;
  align: 'left' | 'right';
  sort: AdjSharpeSort;
  onSort: (c: AdjSharpeSort) => void;
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

export function AdjustedSharpeModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
  const [sort, setSort] = useState<AdjSharpeSort>('asr');
  const tf = TIMEFRAMES[tfIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(','), tf.interval, tf.range],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? adjustedSharpeBoard(data, PERIODS_PER_YEAR, sort) : []), [data, sort]);
  const maxAbs = useMemo(() => Math.max(0.5, ...rows.map((r) => Math.abs(r.asr))), [rows]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank their skew/kurtosis-adjusted Sharpe.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Adjusted Sharpe · {tf.label} daily · annualized</span>
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
          <EmptyState>Not enough history to compute the adjusted Sharpe.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="asr" label="ASR" align="right" sort={sort} onSort={setSort} />
                <SortHead col="sharpe" label="SHARPE" align="right" sort={sort} onSort={setSort} />
                <SortHead col="skew" label="SKEW" align="right" sort={sort} onSort={setSort} />
                <SortHead col="exKurt" label="KURT" align="right" sort={sort} onSort={setSort} />
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
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{
                        width: `${(Math.abs(r.asr) / maxAbs) * 100}%`,
                        background: r.asr >= 0 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
                      }}
                    />
                    <span className={`relative font-semibold ${signColor(r.asr)}`}>{r.asr.toFixed(2)}</span>
                  </td>
                  <td className={`px-2 py-0.5 text-right ${signColor(r.sharpe)}`}>{r.sharpe.toFixed(2)}</td>
                  <td className={`px-2 py-0.5 text-right ${signColor(r.skew)}`}>{r.skew.toFixed(2)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.exKurt.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        ASR = Sharpe penalized for negative skew &amp; excess kurtosis (Pezier-White) · docks fat left tails, rewards positive skew · SKEW/KURT drive it
      </div>
    </div>
  );
}
