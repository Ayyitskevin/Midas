import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { parabolicSarBoard, type SarSort, type SarSide, type SarRow } from '@/lib/parabolicSar';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PRESETS: { label: string; af0: number; afMax: number }[] = [
  { label: '0.02·0.20', af0: 0.02, afMax: 0.2 }, // Wilder standard
  { label: '0.04·0.40', af0: 0.04, afMax: 0.4 }, // faster / more sensitive
];

const sideColor = (side: SarSide) => (side === 'long' ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: SarSort;
  label: string;
  align: 'left' | 'right';
  sort: SarSort;
  onSort: (c: SarSort) => void;
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

function FlipCell({ row }: { row: SarRow }) {
  if (!row.flip) return <span className="text-term-dim">·</span>;
  return row.side === 'long' ? <span className="text-term-up">↑</span> : <span className="text-term-down">↓</span>;
}

export function ParabolicSarModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 0.02·0.20
  const [sort, setSort] = useState<SarSort>('dist');
  const preset = PRESETS[presetIdx];

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

  const rows = useMemo(
    () => (data ? parabolicSarBoard(data, sort, preset.af0, preset.af0, preset.afMax) : []),
    [data, sort, preset.af0, preset.afMax],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to track Parabolic SAR.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Parabolic SAR · AF {preset.label}</span>
        <div className="ml-auto flex gap-1">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPresetIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === presetIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
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
          <EmptyState>Not enough history for Parabolic SAR.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="side" label="SIDE" align="left" sort={sort} onSort={setSort} />
                <SortHead col="dist" label="DIST%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">AF</th>
                <th className="px-2 py-1 text-center font-normal text-term-muted">FLIP</th>
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
                  <td className={`px-2 py-0.5 text-left font-semibold ${sideColor(r.side)}`}>
                    {r.side === 'long' ? 'LONG' : 'SHORT'}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${sideColor(r.side)}`}>
                    {r.dist > 0 ? '+' : ''}
                    {r.dist.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.af.toFixed(2)}</td>
                  <td className="px-2 py-0.5 text-center">
                    <FlipCell row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        SIDE = stop below (<span className="text-term-up">long</span>) / above (
        <span className="text-term-down">short</span>) price · DIST% = close from the stop · AF = acceleration · FLIP =
        reversed this bar
      </div>
    </div>
  );
}
