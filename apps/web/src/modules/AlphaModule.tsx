import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { alphaBoard, type AlphaSort } from '@/lib/alpha';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const MAX = 20;
const PERIODS_PER_YEAR = 365;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const alphaColor = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: AlphaSort;
  label: string;
  align: 'left' | 'right';
  sort: AlphaSort;
  onSort: (c: AlphaSort) => void;
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

export function AlphaModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<AlphaSort>('alpha');
  const tf = TIMEFRAMES[tfIdx];

  // Always fetch BTC as the benchmark, plus the watchlist symbols (deduped).
  const fetchSyms = useMemo(() => Array.from(new Set([BENCH, ...watchlist.slice(0, MAX)])), [watchlist]);

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

  const rows = useMemo(
    () => (data ? alphaBoard(data, BENCH, PERIODS_PER_YEAR, sort) : []),
    [data, sort],
  );
  const maxAbs = useMemo(() => Math.max(0.1, ...rows.map((r) => Math.abs(r.alpha))), [rows]);
  const benchMissing = useMemo(
    () => Boolean(data) && !data!.find((d) => d.symbol === BENCH)?.closes.length,
    [data],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank their Jensen's alpha vs BTC.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Jensen's α vs {base(BENCH)} · daily · annualized</span>
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
        ) : benchMissing ? (
          <EmptyState>No BTC history to benchmark against.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>Add non-BTC watchlist symbols to compare.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="alpha" label="ALPHA" align="right" sort={sort} onSort={setSort} />
                <SortHead col="annReturn" label="RET" align="right" sort={sort} onSort={setSort} />
                <SortHead col="beta" label="BETA" align="right" sort={sort} onSort={setSort} />
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
                        width: `${(Math.abs(r.alpha) / maxAbs) * 100}%`,
                        background: r.alpha >= 0 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
                      }}
                    />
                    <span className={`relative font-semibold ${alphaColor(r.alpha)}`}>
                      {fmtSignedPercent(r.alpha * 100)}
                    </span>
                  </td>
                  <td className={`px-2 py-0.5 text-right ${r.annReturn >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                    {fmtSignedPercent(r.annReturn * 100)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.beta.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        α = ann. return − beta·BTC return · return beyond what BTC exposure (CAPM) predicts · higher is better
      </div>
    </div>
  );
}
