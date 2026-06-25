import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { hurstBoard, type HurstSort, type HurstRegime } from '@/lib/hurst';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

const REGIME: Record<HurstRegime, { chip: string; cls: string; fill: string }> = {
  trending: { chip: 'TREND', cls: 'text-term-amber', fill: 'rgba(255,176,0,0.25)' },
  meanrev: { chip: 'REVERT', cls: 'text-term-accent', fill: 'rgba(76,194,255,0.25)' },
  random: { chip: 'RANDOM', cls: 'text-term-muted', fill: 'rgba(122,127,135,0.22)' },
};

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: HurstSort;
  label: string;
  align: 'left' | 'right';
  sort: HurstSort;
  onSort: (c: HurstSort) => void;
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

export function HurstModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 2Y
  const [sort, setSort] = useState<HurstSort>('hurst');
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

  const rows = useMemo(() => (data ? hurstBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to classify their trend vs mean-reversion regime.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Hurst (R/S) · daily</span>
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
          <EmptyState>Not enough history to estimate the Hurst exponent.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">H (0 ··· 0.5 ··· 1)</th>
                <SortHead col="hurst" label="H" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">REGIME</th>
                <SortHead col="r2" label="R²" align="right" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const reg = REGIME[r.regime];
                const pos = Math.max(0, Math.min(1, r.hurst)) * 100;
                const left = r.hurst >= 0.5 ? 50 : pos;
                const width = Math.abs(pos - 50);
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
                    <td className="px-2 py-0.5">
                      <div className="relative h-3 w-full rounded-sm bg-term-bg/60">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-term-border" />
                        <div
                          className="absolute inset-y-0 rounded-sm"
                          style={{ left: `${left}%`, width: `${Math.max(1, width)}%`, background: reg.fill }}
                        />
                      </div>
                    </td>
                    <td className={`px-2 py-0.5 text-right font-semibold ${reg.cls}`}>{r.hurst.toFixed(2)}</td>
                    <td className={`px-2 py-0.5 text-right font-semibold ${reg.cls}`}>{reg.chip}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{(r.r2 * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span className="text-term-amber">H&gt;0.5</span> trends persist ·{' '}
        <span className="text-term-accent">H&lt;0.5</span> mean-reverts · ≈0.5 random walk · R² = R/S fit
      </div>
    </div>
  );
}
