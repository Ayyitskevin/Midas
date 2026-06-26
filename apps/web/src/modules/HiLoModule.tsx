import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { hiLoBoard, type HiLoSort } from '@/lib/highLow';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// The lookback length defines the N-day high/low, so the toggle drives it.
const WINDOWS: { label: string; window: number }[] = [
  { label: '30D', window: 30 },
  { label: '90D', window: 90 },
  { label: '52W', window: 365 },
];

const posColor = (v: number) => (v >= 80 ? 'text-term-up' : v <= 20 ? 'text-term-down' : 'text-term-text');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: HiLoSort;
  label: string;
  align: 'left' | 'right';
  sort: HiLoSort;
  onSort: (c: HiLoSort) => void;
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

export function HiLoModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [winIdx, setWinIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<HiLoSort>('pos');
  const win = WINDOWS[winIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
            }))
            .catch(() => ({ symbol: s, bars: [] as { high: number; low: number; close: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? hiLoBoard(data, sort, win.window) : []), [data, sort, win.window]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to see high/low proximity.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">High/low proximity · close vs {win.label} range</span>
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((w, i) => (
            <button
              key={w.label}
              onClick={() => setWinIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === winIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {w.label}
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
          <EmptyState>Not enough history to measure range position.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="pos" label="POS" align="right" sort={sort} onSort={setSort} />
                <SortHead col="fromHigh" label="HIGH" align="right" sort={sort} onSort={setSort} />
                <SortHead col="fromLow" label="LOW" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">FLAG</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${posColor(r.pos)}`}>{r.pos.toFixed(0)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{fmtSignedPercent(r.fromHigh, 1)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{fmtSignedPercent(r.fromLow, 1)}</td>
                  <td className="px-2 py-0.5 text-right">
                    {r.freshHigh ? (
                      <span className="text-term-up">NH</span>
                    ) : r.freshLow ? (
                      <span className="text-term-down">NL</span>
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
        POS = close within the {win.label} range (0 = low → 100 = high) · HIGH / LOW = % from the period high / low ·{' '}
        <span className="text-term-up">NH</span> / <span className="text-term-down">NL</span> = new high / low today
      </div>
    </div>
  );
}
