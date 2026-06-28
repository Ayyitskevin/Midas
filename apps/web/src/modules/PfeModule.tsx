import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { pfeBoard, type PfeSort, type PfeZone } from '@/lib/pfe';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const SMOOTHING = 5;
const LOOKBACKS: { label: string; lookback: number }[] = [
  { label: '10', lookback: 10 },
  { label: '20', lookback: 20 },
];

const pfeClass = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function ZoneCell({ zone }: { zone: PfeZone }) {
  if (zone === 'up') return <span className="text-term-up">TREND ↑</span>;
  if (zone === 'down') return <span className="text-term-down">TREND ↓</span>;
  return <span className="text-term-dim">CHOP</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: PfeSort;
  label: string;
  align: 'left' | 'right';
  sort: PfeSort;
  onSort: (c: PfeSort) => void;
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

export function PfeModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [lbIdx, setLbIdx] = useState(0); // default lookback 10
  const [sort, setSort] = useState<PfeSort>('pfe');
  const lb = LOOKBACKS[lbIdx];

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
    () => (data ? pfeBoard(data, sort, lb.lookback, SMOOTHING) : []),
    [data, sort, lb.lookback],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen Polarized Fractal Efficiency.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Polarized Fractal Efficiency · N {lb.label} / EMA 5</span>
        <div className="ml-auto flex gap-1">
          {LOOKBACKS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setLbIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === lbIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
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
          <EmptyState>Not enough history for Polarized Fractal Efficiency.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="pfe" label="PFE" align="right" sort={sort} onSort={setSort} />
                <SortHead col="strength" label="STR" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${pfeClass(r.pfe)}`}>{r.pfe.toFixed(1)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.strength.toFixed(1)}</td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <ZoneCell zone={r.zone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Hannula PFE · straight-line ÷ jagged-path efficiency, polarized by direction · rebased to %-space for
        cross-symbol fairness · <span className="text-term-up">+</span> efficient up /{' '}
        <span className="text-term-down">−</span> efficient down · |PFE| ≥ 50 = trending · sorts most efficient first
      </div>
    </div>
  );
}
