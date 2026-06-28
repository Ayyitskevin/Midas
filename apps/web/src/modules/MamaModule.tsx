import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { mamaBoard, type MamaSort, type MamaDir } from '@/lib/mama';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// FastLimit presets (SlowLimit fixed at Ehlers' 0.05): 0.5 standard vs a smoother 0.25.
const PRESETS: { label: string; fast: number }[] = [
  { label: '0.5', fast: 0.5 },
  { label: '0.25', fast: 0.25 },
];
const SLOW = 0.05;

const dirClass = (d: MamaDir) => (d === 'bull' ? 'text-term-up' : 'text-term-down');
const signColor = (v: number) => (v > 0 ? 'text-term-up' : v < 0 ? 'text-term-down' : 'text-term-muted');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: MamaSort;
  label: string;
  align: 'left' | 'right';
  sort: MamaSort;
  onSort: (c: MamaSort) => void;
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

export function MamaModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default FastLimit 0.5
  const [sort, setSort] = useState<MamaSort>('gap');
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
    () => (data ? mamaBoard(data, sort, preset.fast, SLOW) : []),
    [data, sort, preset.fast],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen MAMA/FAMA.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">MAMA · MESA adaptive · FL{preset.label}</span>
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
          <EmptyState>Not enough history for MAMA/FAMA.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">DIR</th>
                <SortHead col="gap" label="GAP%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">α</th>
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
                  <td className="px-2 py-0.5 text-left">
                    {r.cross !== 'none' && <span className="text-term-amber">✦ </span>}
                    <span className={dirClass(r.dir)}>{r.dir === 'bull' ? 'BULL' : 'BEAR'}</span>
                  </td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${signColor(r.gapPct)}`}>
                    {fmtSignedPercent(r.gapPct, 2)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.alpha.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        MAMA/FAMA adaptive MA · <span className="text-term-up">BULL</span> /{' '}
        <span className="text-term-down">BEAR</span> = MAMA vs FAMA · GAP% = separation · α = adaptive rate ·{' '}
        <span className="text-term-amber">✦</span> fresh cross
      </div>
    </div>
  );
}
