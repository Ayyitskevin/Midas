import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { leadLagBoard, type LeadLagSort } from '@/lib/leadLag';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const MAX = 20;
const MAX_LAG = 5;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

// Negative lag = leads BTC (accent), positive = lags (muted), 0 = synchronous.
const lagColor = (v: number) =>
  v < 0 ? 'text-term-accent' : v > 0 ? 'text-term-muted' : 'text-term-text';
const fmtLag = (v: number) => (v === 0 ? '0' : v > 0 ? `+${v}d` : `${v}d`);

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: LeadLagSort;
  label: string;
  align: 'left' | 'right';
  sort: LeadLagSort;
  onSort: (c: LeadLagSort) => void;
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

export function LeadLagModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 90D
  const [sort, setSort] = useState<LeadLagSort>('peakLag');
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

  const rows = useMemo(() => (data ? leadLagBoard(data, BENCH, MAX_LAG, sort) : []), [data, sort]);
  const benchMissing = useMemo(
    () => Boolean(data) && !data!.find((d) => d.symbol === BENCH)?.closes.length,
    [data],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to see which lead or lag BTC.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Lead-lag vs {base(BENCH)} · ±{MAX_LAG}d · {tf.label}</span>
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
          <EmptyState>No BTC history to lead-lag against.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>Add non-BTC watchlist symbols to compare.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="peakLag" label="LAG" align="right" sort={sort} onSort={setSort} />
                <SortHead col="peakCorr" label="ρpk" align="right" sort={sort} onSort={setSort} />
                <SortHead col="corr0" label="ρ0" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${lagColor(r.peakLag)}`}>
                    {fmtLag(r.peakLag)}
                  </td>
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{
                        width: `${Math.min(1, Math.abs(r.peakCorr)) * 100}%`,
                        background: r.peakCorr >= 0 ? 'rgba(76,194,255,0.12)' : 'rgba(239,77,86,0.12)',
                      }}
                    />
                    <span className="relative text-term-text">{r.peakCorr.toFixed(2)}</span>
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.corr0.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Peak cross-correlation lag vs BTC · <span className="text-term-accent">−Nd</span> = leads BTC · +Nd = lags · ρpk at that lag, ρ0 = contemporaneous
      </div>
    </div>
  );
}
