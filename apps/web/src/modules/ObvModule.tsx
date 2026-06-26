import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { obvBoard, type ObvSort } from '@/lib/obv';
import { fmtCompact, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// The lookback length defines the accumulation window, so the toggle drives it.
const WINDOWS: { label: string; window: number }[] = [
  { label: '30D', window: 30 },
  { label: '90D', window: 90 },
];

const signColor = (v: number) => (v > 0 ? 'text-term-up' : v < 0 ? 'text-term-down' : 'text-term-muted');
const fmtSlope = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`;

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: ObvSort;
  label: string;
  align: 'left' | 'right';
  sort: ObvSort;
  onSort: (c: ObvSort) => void;
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

export function ObvModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [winIdx, setWinIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<ObvSort>('slope');
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
              bars: h.candles.map((c) => ({ close: c.close, volume: c.volume })),
            }))
            .catch(() => ({ symbol: s, bars: [] as { close: number; volume: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? obvBoard(data, sort, win.window) : []), [data, sort, win.window]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to see accumulation flow.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">On-balance volume · accumulation vs distribution · {win.label}</span>
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
          <EmptyState>Not enough history to measure OBV.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="obv" label="OBV" align="right" sort={sort} onSort={setSort} />
                <SortHead col="flow" label="FLOW" align="right" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="TREND" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right ${signColor(r.obv)}`}>{fmtCompact(r.obv)}</td>
                  <td className={`px-2 py-0.5 text-right ${signColor(r.flow)}`}>{fmtSignedPercent(r.flow * 100, 0)}</td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${signColor(r.slopePct)}`}>
                    {fmtSlope(r.slopePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        OBV = cumulative signed volume · FLOW = net up − down volume share ·{' '}
        <span className="text-term-up">TREND&gt;0</span> accumulation /{' '}
        <span className="text-term-down">&lt;0</span> distribution (OBV slope ÷ avg vol)
      </div>
    </div>
  );
}
