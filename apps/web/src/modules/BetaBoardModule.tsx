import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { betaBoard, type BetaSort } from '@/lib/beta';
import { corrColor } from '@/lib/correlation';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const MAX = 20;

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const base = (sym: string) => sym.replace(/\/.*$/, '');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: BetaSort;
  label: string;
  align: 'left' | 'right';
  sort: BetaSort;
  onSort: (c: BetaSort) => void;
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

export function BetaBoardModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<BetaSort>('beta');
  const tf = TIMEFRAMES[tfIdx];

  // Always fetch BTC as the benchmark, plus the watchlist symbols (deduped).
  const fetchSyms = useMemo(
    () => Array.from(new Set([BENCH, ...watchlist.slice(0, MAX)])),
    [watchlist],
  );

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

  const rows = useMemo(() => (data ? betaBoard(data, BENCH, sort) : []), [data, sort]);
  const maxAbsBeta = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.beta))), [rows]);
  const benchMissing = useMemo(
    () => Boolean(data) && !data!.find((d) => d.symbol === BENCH)?.closes.length,
    [data],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank their beta vs BTC.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">beta vs {base(BENCH)} · daily returns</span>
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
                <SortHead col="beta" label="β" align="right" sort={sort} onSort={setSort} />
                <SortHead col="correlation" label="CORR" align="right" sort={sort} onSort={setSort} />
                <SortHead col="r2" label="R²" align="right" sort={sort} onSort={setSort} />
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
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{
                        width: `${(Math.abs(r.beta) / maxAbsBeta) * 100}%`,
                        background: r.beta >= 0 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
                      }}
                    />
                    <span
                      className={`relative font-semibold ${
                        r.beta < 0 ? 'text-term-down' : Math.abs(r.beta) >= 1 ? 'text-term-amber' : 'text-term-up'
                      }`}
                    >
                      {r.beta.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    <span className="rounded-sm px-1 text-term-text" style={{ backgroundColor: corrColor(r.correlation) }}>
                      {r.correlation.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.r2 * 100).toFixed(0)}%</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.vol * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        β above 1 amplifies BTC · negative β is inverse · R² = variance explained by BTC
      </div>
    </div>
  );
}
