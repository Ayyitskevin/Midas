import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { stochRsiBoard, type StochRsiSort, type StochRsiZone } from '@/lib/stochRsi';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const SMOOTH_K = 3;
const SMOOTH_D = 3;
const PERIODS: { label: string; rsiPeriod: number; stochPeriod: number }[] = [
  { label: '14', rsiPeriod: 14, stochPeriod: 14 },
  { label: '21', rsiPeriod: 21, stochPeriod: 21 },
];

const kClass = (v: number) => (v >= 50 ? 'text-term-up' : 'text-term-down');

function ZoneCell({ zone }: { zone: StochRsiZone }) {
  if (zone === 'overbought') return <span className="text-term-down">OB</span>;
  if (zone === 'oversold') return <span className="text-term-up">OS</span>;
  return <span className="text-term-dim">·</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: StochRsiSort;
  label: string;
  align: 'left' | 'right';
  sort: StochRsiSort;
  onSort: (c: StochRsiSort) => void;
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

export function StochRsiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 14
  const [sort, setSort] = useState<StochRsiSort>('k');
  const per = PERIODS[perIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? stochRsiBoard(data, sort, per.rsiPeriod, per.stochPeriod, SMOOTH_K, SMOOTH_D) : []),
    [data, sort, per.rsiPeriod, per.stochPeriod],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Stochastic RSI.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Stochastic RSI · {per.label} / {per.label} · K{SMOOTH_K} D{SMOOTH_D}</span>
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
          <EmptyState>Not enough history for the Stochastic RSI.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="k" label="%K" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">%D</th>
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${kClass(r.k)}`}>{r.k.toFixed(1)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.d.toFixed(1)}</td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <ZoneCell zone={r.zone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Stochastic RSI · Stochastic of the RSI series (faster, more extremes) · <span className="text-term-down">≥
        80 OB</span> / <span className="text-term-up">≤ 20 OS</span> · %D = signal · sorts highest first
      </div>
    </div>
  );
}
