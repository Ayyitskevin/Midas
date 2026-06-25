import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { signalBoard, type SignalSort, type RsiState, type RangeState } from '@/lib/signals';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const rsiColor = (s: RsiState | null) =>
  s === 'overbought' ? 'text-term-down' : s === 'oversold' ? 'text-term-up' : 'text-term-muted';
const rangeFill = (s: RangeState | null) =>
  s === 'high' ? 'rgba(255,176,0,0.3)' : s === 'low' ? 'rgba(38,194,129,0.3)' : 'rgba(122,127,135,0.25)';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: SignalSort;
  label: string;
  align: 'left' | 'right';
  sort: SignalSort;
  onSort: (c: SignalSort) => void;
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

export function ScanModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<SignalSort>('score');

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, '1d', '1y', signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? signalBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to scan for technical signals.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">signal scan · daily</span>
        <span className="ml-auto text-term-dim">SMA20/50 · RSI14 · 52w</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>No history to scan.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="score" label="TREND" align="right" sort={sort} onSort={setSort} />
                <SortHead col="rsi" label="RSI" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">52W</th>
                <SortHead col="range" label="%" align="right" sort={sort} onSort={setSort} />
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
                      r.trend === 'up' ? 'text-term-up' : r.trend === 'down' ? 'text-term-down' : 'text-term-muted'
                    }`}
                  >
                    {r.trend === 'up' ? '▲ up' : r.trend === 'down' ? '▼ dn' : '—'}
                  </td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${rsiColor(r.rsiState)}`}>
                    {r.rsi == null ? '—' : r.rsi.toFixed(0)}
                  </td>
                  <td className="px-2 py-0.5">
                    <div className="relative h-3 w-full rounded-sm bg-term-bg/60">
                      {r.rangePct != null && (
                        <div
                          className="absolute inset-y-0 left-0 rounded-sm"
                          style={{ width: `${Math.max(2, r.rangePct)}%`, background: rangeFill(r.rangeState) }}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {r.rangePct == null ? '—' : `${r.rangePct.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span className="text-term-up">▲</span> SMA20&gt;50 · RSI <span className="text-term-up">≤30</span>/
        <span className="text-term-down">≥70</span> · 52w range position · sorted by bull/bear score
      </div>
    </div>
  );
}
