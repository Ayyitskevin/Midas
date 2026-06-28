import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { tcfBoard, type TcfSort, type TcfRegime } from '@/lib/tcf';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; length: number }[] = [
  { label: '35', length: 35 },
  { label: '20', length: 20 },
];

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: TcfSort;
  label: string;
  align: 'left' | 'right';
  sort: TcfSort;
  onSort: (c: TcfSort) => void;
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

function RegimeCell({ regime }: { regime: TcfRegime }) {
  if (regime === 'up') return <span className="text-term-up">▲ UP</span>;
  if (regime === 'down') return <span className="text-term-down">▼ DN</span>;
  return <span className="text-term-dim">~ RNG</span>;
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

export function TcfModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default length 35
  const [sort, setSort] = useState<TcfSort>('plus');
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

  const rows = useMemo(() => (data ? tcfBoard(data, sort, per.length) : []), [data, sort, per.length]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Trend Continuation Factor.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Trend Continuation Factor · length {per.label}</span>
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
          <EmptyState>Not enough history for the Trend Continuation Factor.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="plus" label="+TCF" align="right" sort={sort} onSort={setSort} />
                <SortHead col="minus" label="−TCF" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">DIR</th>
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
                  <td
                    className={`px-2 py-0.5 text-right font-semibold ${
                      r.trendPlus > 0 ? 'text-term-up' : 'text-term-muted'
                    }`}
                  >
                    {signed(r.trendPlus)}
                  </td>
                  <td
                    className={`px-2 py-0.5 text-right ${r.trendMinus > 0 ? 'text-term-down' : 'text-term-muted'}`}
                  >
                    {signed(r.trendMinus)}
                  </td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <RegimeCell regime={r.regime} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        M.H. Pee TCF on percent returns · <span className="text-term-up">+TCF&gt;0 = uptrend</span> ·{' '}
        <span className="text-term-down">−TCF&gt;0 = downtrend</span> · both ≤ 0 = consolidation · sorts most
        bullish first
      </div>
    </div>
  );
}
