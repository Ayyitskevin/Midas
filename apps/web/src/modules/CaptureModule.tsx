import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { captureBoard, type CaptureSort } from '@/lib/capture';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const MAX = 20;
const base = (sym: string) => sym.replace(/\/.*$/, '');
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const upColor = (v: number | null) => (v == null ? 'text-term-muted' : v >= 1 ? 'text-term-up' : 'text-term-text');
const downColor = (v: number | null) => (v == null ? 'text-term-muted' : v <= 1 ? 'text-term-up' : 'text-term-down');
const ratioColor = (v: number | null) => (v == null ? 'text-term-muted' : v >= 1 ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  sort,
  onSort,
}: {
  col: CaptureSort;
  label: string;
  sort: CaptureSort;
  onSort: (c: CaptureSort) => void;
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

export function CaptureModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<CaptureSort>('ratio');
  const tf = TIMEFRAMES[tfIdx];

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

  const rows = useMemo(() => (data ? captureBoard(data, BENCH, sort) : []), [data, sort]);
  const benchMissing = useMemo(
    () => Boolean(data) && !data!.find((d) => d.symbol === BENCH)?.closes.length,
    [data],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to measure up/down capture vs BTC.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">up/down capture vs {base(BENCH)} · daily</span>
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
                <th className="px-2 py-1 text-left font-normal">
                  <button
                    onClick={() => setSort('symbol')}
                    className={`no-drag hover:text-term-amber ${sort === 'symbol' ? 'text-term-amber' : 'text-term-muted'}`}
                  >
                    SYMBOL
                  </button>
                </th>
                <SortHead col="up" label="UP" sort={sort} onSort={setSort} />
                <SortHead col="down" label="DOWN" sort={sort} onSort={setSort} />
                <SortHead col="ratio" label="RATIO" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const w = r.ratio == null ? 0 : Math.min(100, (Math.max(0, r.ratio) / 2) * 100);
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
                    <td className={`px-2 py-0.5 text-right ${upColor(r.up)}`}>{pct(r.up)}</td>
                    <td className={`px-2 py-0.5 text-right ${downColor(r.down)}`}>{pct(r.down)}</td>
                    <td className="relative px-2 py-0.5 text-right">
                      <div
                        className="absolute inset-y-0 right-0"
                        style={{
                          width: `${w}%`,
                          background: (r.ratio ?? 0) >= 1 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
                        }}
                      />
                      <span className={`relative font-semibold ${ratioColor(r.ratio)}`}>
                        {r.ratio == null ? '—' : r.ratio.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        UP/DOWN = share of BTC up/down moves captured · ratio &gt; 1 catches more upside than downside
      </div>
    </div>
  );
}
