import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { martinTermBoard, type MartinTermSort } from '@/lib/martinTerm';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const PERIODS_PER_YEAR = 365;
const base = (sym: string) => sym.replace(/\/.*$/, '');

// Trailing windows (in daily closes) and their display labels.
const WINDOWS = [30, 90, 180, 365];
const LABELS = ['1M', '3M', '6M', '1Y'];

const martinColor = (v: number | null) =>
  v == null ? 'text-term-up' : v >= 0 ? 'text-term-up' : 'text-term-down';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: MartinTermSort;
  label: string;
  align: 'left' | 'right';
  sort: MartinTermSort;
  onSort: (c: MartinTermSort) => void;
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

export function MartinModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<MartinTermSort>(WINDOWS.length - 1); // default: 1Y column

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, '1d', '2y', signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? martinTermBoard(data, WINDOWS, PERIODS_PER_YEAR, sort) : []),
    [data, sort],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to see the Martin (UPI) ratio across horizons.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Martin (UPI) term structure · ann. return ÷ Ulcer · 2Y daily</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to compute the Martin ratio.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                {LABELS.map((label, i) => (
                  <SortHead key={label} col={i} label={label} align="right" sort={sort} onSort={setSort} />
                ))}
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
                  {r.martins.map((m, i) => (
                    <td
                      key={i}
                      className={`px-2 py-0.5 text-right ${martinColor(m)} ${sort === i ? 'font-semibold' : ''}`}
                    >
                      {m == null ? '∞' : m.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Martin = ann. return ÷ Ulcer Index over each trailing window · rising 1Y→1M = improving · <span className="text-term-up">∞</span> = no drawdown in the window
      </div>
    </div>
  );
}
