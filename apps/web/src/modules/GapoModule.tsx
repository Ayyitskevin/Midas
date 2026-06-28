import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { gapoBoard, type GapoSort, type GapoDir } from '@/lib/gapo';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Lookback presets: canonical N=5 vs a smoother N=14 (matching the CHOP window).
const PRESETS: { label: string; period: number }[] = [
  { label: '5', period: 5 },
  { label: '14', period: 14 },
];

const DIR_GLYPH: Record<GapoDir, string> = { up: '▲', down: '▼', flat: '–' };
const dirClass = (d: GapoDir) =>
  d === 'up' ? 'text-term-up' : d === 'down' ? 'text-term-down' : 'text-term-muted';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: GapoSort;
  label: string;
  align: 'left' | 'right';
  sort: GapoSort;
  onSort: (c: GapoSort) => void;
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

export function GapoModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default N=5 (canonical)
  const [sort, setSort] = useState<GapoSort>('range');
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
    () => (data ? gapoBoard(data, sort, preset.period) : []),
    [data, sort, preset.period],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the range index.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">GAPO · range index · N{preset.period}</span>
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
          <EmptyState>Not enough history for the range index.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="gapo" label="GAPO" align="right" sort={sort} onSort={setSort} />
                <SortHead col="range" label="RANGE%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="EXP" align="right" sort={sort} onSort={setSort} />
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
                  <td className="px-2 py-0.5 text-right text-term-text">{r.gapo.toFixed(2)}</td>
                  <td className="px-2 py-0.5 text-right font-semibold text-term-text">
                    {r.rangePct.toFixed(1)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${dirClass(r.dir)}`}>
                    {DIR_GLYPH[r.dir]} {r.slope >= 0 ? '+' : ''}
                    {r.slope.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        GAPO = ln(range)/ln(N) · RANGE% = range vs price (scale-invariant, default sort) ·{' '}
        EXP = range <span className="text-term-up">▲ expanding</span> /{' '}
        <span className="text-term-down">▼ contracting</span>
      </div>
    </div>
  );
}
