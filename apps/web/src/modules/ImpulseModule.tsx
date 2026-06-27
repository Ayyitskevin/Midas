import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import type { Candle } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { impulseBoard, type ImpulseSort, type Impulse } from '@/lib/impulse';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const IMPULSE_LABEL: Record<Impulse, string> = { bull: '▲ BULL', bear: '▼ BEAR', neutral: '● FLAT' };

function impulseClass(im: Impulse) {
  return im === 'bull' ? 'text-term-up' : im === 'bear' ? 'text-term-down' : 'text-term-dim';
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: ImpulseSort;
  label: string;
  align: 'left' | 'right';
  sort: ImpulseSort;
  onSort: (c: ImpulseSort) => void;
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

export function ImpulseModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<ImpulseSort>('impulse');
  const [freshOnly, setFreshOnly] = useState(false);

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, candles: h.candles as Candle[] }))
            .catch(() => ({ symbol: s, candles: [] as Candle[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => {
    const board = data ? impulseBoard(data, sort) : [];
    return freshOnly ? board.filter((r) => r.changed) : board;
  }, [data, sort, freshOnly]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Elder Impulse System.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Elder Impulse · 13-EMA + MACD(12/26/9)</span>
        <button
          onClick={() => setFreshOnly((v) => !v)}
          className={`no-drag ml-auto rounded-sm px-1.5 py-0.5 ${
            freshOnly ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
          }`}
        >
          {freshOnly ? 'fresh flips' : 'all bars'}
        </button>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>{freshOnly ? 'No fresh impulse flips on the latest bar.' : 'Not enough history to compute the impulse.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="impulse" label="IMPULSE" align="left" sort={sort} onSort={setSort} />
                <SortHead col="emaSlopePct" label="EMA%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="histPct" label="HIST%" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-left font-semibold ${impulseClass(r.impulse)}`}>
                    {IMPULSE_LABEL[r.impulse]}
                    {r.changed && <span className="ml-1 text-term-amber">·new</span>}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.emaSlopePct)}`}>
                    {r.emaSlopePct > 0 ? '+' : ''}
                    {r.emaSlopePct.toFixed(2)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.histPct)}`}>
                    {r.histPct > 0 ? '+' : ''}
                    {r.histPct.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span className="text-term-up">▲ bull</span> = EMA &amp; histogram both rising ·{' '}
        <span className="text-term-down">▼ bear</span> = both falling · ● flat = mixed
      </div>
    </div>
  );
}
