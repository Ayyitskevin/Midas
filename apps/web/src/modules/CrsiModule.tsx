import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { crsiBoard, type CrsiSort } from '@/lib/crsi';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Connors defaults: RSI(close) 3, RSI(streak) 2, percent-rank lookback 100.
const RSI_P = 3;
const STREAK_P = 2;
const RANK_P = 100;

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: CrsiSort;
  label: string;
  align: 'left' | 'right';
  sort: CrsiSort;
  onSort: (c: CrsiSort) => void;
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

// Mean-reversion coloring: oversold (washed out) reads bullish, overbought bearish.
function crsiClass(zone: string) {
  return zone === 'os' ? 'text-term-up' : zone === 'ob' ? 'text-term-down' : 'text-term-text';
}

export function CrsiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<CrsiSort>('crsi');

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
    () => (data ? crsiBoard(data, sort, RSI_P, STREAK_P, RANK_P) : []),
    [data, sort],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen Connors RSI.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Connors RSI · RSI 3 + streak RSI 2 + %rank 100</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to compute Connors RSI.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="crsi" label="CRSI" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">RSI</th>
                <th className="px-2 py-1 text-right font-normal text-term-muted">STRK</th>
                <th className="px-2 py-1 text-right font-normal text-term-muted">%R</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${crsiClass(r.zone)}`}>
                    {r.crsi.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.rsiClose.toFixed(0)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.rsiStreak.toFixed(0)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.pctRank.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        CRSI = (RSI₃ + streakRSI₂ + %rank₁₀₀) ÷ 3 · <span className="text-term-up">&lt; 10 oversold</span> /{' '}
        <span className="text-term-down">&gt; 90 overbought</span>
      </div>
    </div>
  );
}
