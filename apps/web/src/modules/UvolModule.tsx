import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { volSurgeBoard, type VolSurgeSort } from '@/lib/volumeSurge';
import { fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// The baseline length is what defines "unusual", so the toggle drives the window.
const WINDOWS: { label: string; window: number }[] = [
  { label: '20d', window: 20 },
  { label: '50d', window: 50 },
];

const fmtSurge = (v: number) => `${v.toFixed(2)}×`;
const fmtZ = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`;
const surgeColor = (v: number) =>
  v >= 3 ? 'text-term-amber font-semibold' : v >= 1.5 ? 'text-term-amber' : v >= 1 ? 'text-term-text' : 'text-term-muted';
const zColor = (v: number) => (Math.abs(v) >= 2 ? 'text-term-amber' : 'text-term-muted');

function DirGlyph({ d }: { d: number }) {
  if (d > 0) return <span className="text-term-up">▲</span>;
  if (d < 0) return <span className="text-term-down">▼</span>;
  return <span className="text-term-muted">·</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: VolSurgeSort;
  label: string;
  align: 'left' | 'right';
  sort: VolSurgeSort;
  onSort: (c: VolSurgeSort) => void;
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

export function UvolModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [winIdx, setWinIdx] = useState(0); // default 20d
  const [sort, setSort] = useState<VolSurgeSort>('surge');
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

  const rows = useMemo(() => (data ? volSurgeBoard(data, sort, win.window) : []), [data, sort, win.window]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to see unusual volume.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Relative volume · today vs {win.label} avg</span>
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
          <EmptyState>Not enough history to measure volume.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="volume" label="VOL" align="right" sort={sort} onSort={setSort} />
                <SortHead col="surge" label="RVOL" align="right" sort={sort} onSort={setSort} />
                <SortHead col="z" label="Z" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">DIR</th>
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
                  <td className="px-2 py-0.5 text-right text-term-muted">{fmtCompact(r.volume)}</td>
                  <td className={`px-2 py-0.5 text-right ${surgeColor(r.surge)}`}>{fmtSurge(r.surge)}</td>
                  <td className={`px-2 py-0.5 text-right ${zColor(r.z)}`}>{fmtZ(r.z)}</td>
                  <td className="px-2 py-0.5 text-right">
                    <DirGlyph d={r.direction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        RVOL = today's volume ÷ {win.label} average · Z = standard score vs that window · DIR ={' '}
        <span className="text-term-up">▲</span> up-day surge (accumulation) /{' '}
        <span className="text-term-down">▼</span> down-day (distribution)
      </div>
    </div>
  );
}
