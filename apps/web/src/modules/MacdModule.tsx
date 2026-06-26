import { useMemo, useState } from 'react';
import type { Candle, Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { macdBoard, type MacdSort } from '@/lib/macdBoard';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const signColor = (v: number) => (v > 0 ? 'text-term-up' : v < 0 ? 'text-term-down' : 'text-term-muted');
const fmtMacd = (v: number) => (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: MacdSort;
  label: string;
  align: 'left' | 'right';
  sort: MacdSort;
  onSort: (c: MacdSort) => void;
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

export function MacdModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<MacdSort>('histPct');

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, candles: h.candles }))
            .catch(() => ({ symbol: s, candles: [] as Candle[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? macdBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen MACD.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">MACD 12/26/9 · momentum &amp; signal cross · daily</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to compute MACD.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="histPct" label="HIST%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="macd" label="MACD" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">STATE</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${signColor(r.histPct)}`}>
                    {fmtSignedPercent(r.histPct, 2)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${signColor(r.macd)}`}>{fmtMacd(r.macd)}</td>
                  <td className="px-2 py-0.5 text-right">
                    {r.cross !== 'none' && <span className="text-term-amber">✦ </span>}
                    <span className={r.bullish ? 'text-term-up' : 'text-term-down'}>{r.bullish ? 'BULL' : 'BEAR'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        HIST% = histogram ÷ price · <span className="text-term-up">BULL</span> / <span className="text-term-down">BEAR</span> = MACD vs signal ·{' '}
        <span className="text-term-amber">✦</span> = fresh cross this bar
      </div>
    </div>
  );
}
