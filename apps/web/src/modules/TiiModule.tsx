import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { tiiBoard, type TiiSort, type TiiTrend } from '@/lib/tii';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; major: number }[] = [
  { label: '60', major: 60 },
  { label: '30', major: 30 },
];

const TREND_LABEL: Record<TiiTrend, string> = {
  'strong-up': '▲ strong',
  up: '▲ up',
  flat: '· flat',
  down: '▼ down',
  'strong-down': '▼ strong',
};

function trendClass(t: TiiTrend) {
  if (t === 'strong-up' || t === 'up') return 'text-term-up';
  if (t === 'strong-down' || t === 'down') return 'text-term-down';
  return 'text-term-dim';
}

function tiiClass(tii: number) {
  return tii > 50 ? 'text-term-up' : tii < 50 ? 'text-term-down' : 'text-term-dim';
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: TiiSort;
  label: string;
  align: 'left' | 'right';
  sort: TiiSort;
  onSort: (c: TiiSort) => void;
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

export function TiiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 60
  const [sort, setSort] = useState<TiiSort>('tii');
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
    () => (data ? tiiBoard(data, sort, per.major) : []),
    [data, sort, per.major],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Trend Intensity Index.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Trend Intensity · {per.label}-SMA · {Math.floor(per.major / 2)}-bar window</span>
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
          <EmptyState>Not enough history to compute the Trend Intensity Index.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="tii" label="TII" align="right" sort={sort} onSort={setSort} />
                <SortHead col="delta" label="Δ" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">TREND</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${tiiClass(r.tii)}`}>
                    {r.tii.toFixed(1)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.delta)}`}>
                    {r.delta > 0 ? '+' : ''}
                    {r.delta.toFixed(1)}
                  </td>
                  <td className={`px-2 py-0.5 text-center ${trendClass(r.trend)}`}>{TREND_LABEL[r.trend]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        TII = 100 × Σ⁺dev ÷ (Σ⁺dev + Σ⁻dev) from the {per.label}-SMA ·{' '}
        <span className="text-term-up">&gt; 50</span> uptrend / <span className="text-term-down">&lt; 50</span> down · 80 / 20 = strong
      </div>
    </div>
  );
}
