import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { gannHiloBoard, type GannHiloSort, type GannHiloDir } from '@/lib/gannhilo';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; period: number }[] = [
  { label: '3', period: 3 },
  { label: '10', period: 10 },
];

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: GannHiloSort;
  label: string;
  align: 'left' | 'right';
  sort: GannHiloSort;
  onSort: (c: GannHiloSort) => void;
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

function DirCell({ dir, flip }: { dir: GannHiloDir; flip: boolean }) {
  return (
    <span className={dir === 'up' ? 'text-term-up' : 'text-term-down'}>
      {flip && <span className="text-term-amber">✦ </span>}
      {dir === 'up' ? '▲ UP' : '▼ DN'}
    </span>
  );
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export function GannHiLoModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default period 3
  const [sort, setSort] = useState<GannHiloSort>('trend');
  const per = PERIODS[perIdx];

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

  const rows = useMemo(() => (data ? gannHiloBoard(data, sort, per.period) : []), [data, sort, per.period]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Gann HiLo Activator.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Gann HiLo Activator · period {per.label}</span>
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
          <EmptyState>Not enough history for the Gann HiLo Activator.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="dist" label="DIST%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="trend" label="AGE" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.distPct)}`}>
                    {signed(r.distPct)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.age}</td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <DirCell dir={r.direction} flip={r.flip} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Gann HiLo Activator · SMA(high)/SMA(low) stop-and-reverse · DIST% = close vs the activator/stop · AGE =
        bars in trend · <span className="text-term-amber">✦</span> fresh flip · sorts longest uptrends first
      </div>
    </div>
  );
}
