import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import {
  tdCountdownBoard,
  type TdCountdownSort,
  type TdCountdownDir,
  type TdBar,
} from '@/lib/tdCountdown';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

function DirCell({ direction }: { direction: TdCountdownDir }) {
  if (direction === 'buy') return <span className="text-term-up">BUY ↓</span>;
  if (direction === 'sell') return <span className="text-term-down">SELL ↑</span>;
  return <span className="text-term-dim">·</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: TdCountdownSort;
  label: string;
  align: 'left' | 'right';
  sort: TdCountdownSort;
  onSort: (c: TdCountdownSort) => void;
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

export function TdCountdownModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<TdCountdownSort>('count');

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })) as TdBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as TdBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? tdCountdownBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen TD Sequential countdowns.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">TD Sequential · TD Countdown · 1–13 exhaustion count</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history for TD Sequential countdowns.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">DIR</th>
                <SortHead col="count" label="COUNT" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">DONE</th>
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
                  <td className="px-2 py-0.5 text-left font-semibold">
                    <DirCell direction={r.direction} />
                  </td>
                  <td
                    className={`px-2 py-0.5 text-right font-semibold ${
                      r.completed ? 'text-term-amber' : r.count > 0 ? 'text-term-text' : 'text-term-dim'
                    }`}
                  >
                    {r.count > 0 ? `${r.count}${r.deferred ? '+' : ''}` : '·'}
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    {r.completed ? (
                      <span className="text-term-amber">✓</span>
                    ) : (
                      <span className="text-term-dim">·</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        DeMark TD Countdown · after a completed setup, count to 13 (buy: close ≤ low[2 back] / sell: close ≥ high[2
        back]) · <span className="text-term-amber">13 ✓</span> = exhaustion, &ldquo;+&rdquo; = deferred · sorts
        highest count first
      </div>
    </div>
  );
}
