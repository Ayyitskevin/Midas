import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { sharpeBoard, type SharpeSort } from '@/lib/sharpe';
import { fmtSignedPercent, changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const PERIODS_PER_YEAR = 365; // daily candles, crypto trades 24/7

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const base = (sym: string) => sym.replace(/\/.*$/, '');

/** Green for positive risk-adjusted return, red for negative, amber when strong. */
function ratioColor(v: number | null): string {
  if (v == null) return 'text-term-dim';
  if (v < 0) return 'text-term-down';
  return v >= 1.5 ? 'text-term-amber' : 'text-term-up';
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: SharpeSort;
  label: string;
  align: 'left' | 'right';
  sort: SharpeSort;
  onSort: (c: SharpeSort) => void;
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

export function SharpeModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<SharpeSort>('sharpe');
  const tf = TIMEFRAMES[tfIdx];

  const symbols = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        symbols.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [symbols.join(','), tf.interval, tf.range],
    { enabled: symbols.length > 0 },
  );

  const rows = useMemo(() => (data ? sharpeBoard(data, PERIODS_PER_YEAR, sort) : []), [data, sort]);
  const maxAbsSharpe = useMemo(
    () => Math.max(1, ...rows.map((r) => Math.abs(r.sharpe ?? 0))),
    [rows],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank risk-adjusted return.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">risk-adjusted return · daily · rf 0%</span>
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
          <EmptyState>Not enough history to score.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="sharpe" label="SHARPE" align="right" sort={sort} onSort={setSort} />
                <SortHead col="sortino" label="SORTINO" align="right" sort={sort} onSort={setSort} />
                <SortHead col="annReturn" label="RET" align="right" sort={sort} onSort={setSort} />
                <SortHead col="annVol" label="VOL" align="right" sort={sort} onSort={setSort} />
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
                        width: `${(Math.abs(r.sharpe ?? 0) / maxAbsSharpe) * 100}%`,
                        background: (r.sharpe ?? 0) >= 0 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
                      }}
                    />
                    <span className={`relative font-semibold ${ratioColor(r.sharpe)}`}>
                      {r.sharpe == null ? '—' : r.sharpe.toFixed(2)}
                    </span>
                  </td>
                  <td className={`px-2 py-0.5 text-right ${ratioColor(r.sortino)}`}>
                    {r.sortino == null ? '—' : r.sortino.toFixed(2)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.annReturn)}`}>
                    {fmtSignedPercent(r.annReturn * 100, 0)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.annVol * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Sharpe = mean ÷ σ · Sortino = mean ÷ downside σ · annualized √365 · returns annualized (arithmetic)
      </div>
    </div>
  );
}
