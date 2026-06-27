import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { cksBoard, type CksSort, type CksRegime, type CksBar } from '@/lib/cks';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const MULTS: { label: string; x: number }[] = [
  { label: '1×', x: 1 },
  { label: '3×', x: 3 },
];

const REGIME_LABEL: Record<CksRegime, string> = { up: '▲ up', down: '▼ down', mid: '· mid' };

function regimeClass(r: CksRegime) {
  return r === 'up' ? 'text-term-up' : r === 'down' ? 'text-term-down' : 'text-term-dim';
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: CksSort;
  label: string;
  align: 'left' | 'right' | 'center';
  sort: CksSort;
  onSort: (c: CksSort) => void;
}) {
  const justify = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`px-2 py-1 font-normal ${justify}`}>
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}

export function CksModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [multIdx, setMultIdx] = useState(0); // default 1×
  const [sort, setSort] = useState<CksSort>('pos');
  const mult = MULTS[multIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })) as CksBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as CksBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? cksBoard(data, sort, 10, mult.x, 9) : []),
    [data, sort, mult.x],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Chande Kroll Stop.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Chande Kroll Stop · ATR(10) · stop 9 · {mult.label} ATR</span>
        <div className="ml-auto flex gap-1">
          {MULTS.map((m, i) => (
            <button
              key={m.label}
              onClick={() => setMultIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === multIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {m.label}
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
          <EmptyState>Not enough history to compute the Chande Kroll Stop.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="pos" label="REGIME" align="center" sort={sort} onSort={setSort} />
                <SortHead col="support" label="SUPP%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="resist" label="RES%" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-center font-semibold ${regimeClass(r.regime)}`}>
                    {REGIME_LABEL[r.regime]}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {r.supportPct > 0 ? '+' : ''}
                    {r.supportPct.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {r.resistPct > 0 ? '+' : ''}
                    {r.resistPct.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span className="text-term-up">▲ up</span> = close above the upper stop ·{' '}
        <span className="text-term-down">▼ down</span> = below the lower stop · SUPP/RES = % to each stop
      </div>
    </div>
  );
}
