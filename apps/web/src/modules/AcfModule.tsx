import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { acfBoard, type AcfSort, type AcfVerdict } from '@/lib/autocorr';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

const VERDICT: Record<AcfVerdict, { label: string; cls: string }> = {
  momentum: { label: 'momentum', cls: 'text-term-up' },
  reverting: { label: 'reverting', cls: 'text-term-down' },
  random: { label: 'random', cls: 'text-term-muted' },
};

const lagColor = (v: number) => (v > 0.1 ? 'text-term-up' : v < -0.1 ? 'text-term-down' : 'text-term-muted');

function SortHead({
  col,
  label,
  sort,
  onSort,
}: {
  col: AcfSort;
  label: string;
  sort: AcfSort;
  onSort: (c: AcfSort) => void;
}) {
  return (
    <th className="px-2 py-1 text-right font-normal">
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}

export function AcfModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
  const [sort, setSort] = useState<AcfSort>('lag1');
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

  const rows = useMemo(() => (data ? acfBoard(data, sort) : []), [data, sort]);
  const maxAbs = useMemo(() => Math.max(0.1, ...rows.map((r) => Math.abs(r.lag1))), [rows]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to test return autocorrelation (momentum vs reversion).</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">autocorrelation · {tf.label} daily</span>
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
          <EmptyState>Not enough history to measure autocorrelation.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <th className="px-2 py-1 text-left font-normal">
                  <button
                    onClick={() => setSort('symbol')}
                    className={`no-drag hover:text-term-amber ${sort === 'symbol' ? 'text-term-amber' : 'text-term-muted'}`}
                  >
                    SYMBOL
                  </button>
                </th>
                <SortHead col="lag1" label="LAG1" sort={sort} onSort={setSort} />
                <SortHead col="lag2" label="LAG2" sort={sort} onSort={setSort} />
                <SortHead col="lag3" label="LAG3" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">REGIME</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const neg = r.lag1 < 0;
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
                    <td className="relative px-2 py-0.5 text-right">
                      <div
                        className={`absolute inset-y-0 right-0 ${neg ? 'bg-term-down/12' : 'bg-term-up/12'}`}
                        style={{ width: `${(Math.abs(r.lag1) / maxAbs) * 100}%` }}
                      />
                      <span className={`relative font-semibold ${lagColor(r.lag1)}`}>{r.lag1.toFixed(2)}</span>
                    </td>
                    <td className={`px-2 py-0.5 text-right ${lagColor(r.lag2)}`}>{r.lag2.toFixed(2)}</td>
                    <td className={`px-2 py-0.5 text-right ${lagColor(r.lag3)}`}>{r.lag3.toFixed(2)}</td>
                    <td className={`px-2 py-0.5 text-right ${VERDICT[r.verdict].cls}`}>{VERDICT[r.verdict].label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        lagN = corr(return, return N bars ago) · <span className="text-term-up">+</span> persists (momentum), <span className="text-term-down">−</span> reverses (mean-reversion), ~0 random walk
      </div>
    </div>
  );
}
