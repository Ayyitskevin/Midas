import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { psoBoard, type PsoSort, type PsoBar } from '@/lib/premierstoch';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Leibfarth smoothing EMA period (= round(√25)).
const SMOOTH = 5;

const LENGTHS: { label: string; length: number }[] = [
  { label: '8', length: 8 },
  { label: '12', length: 12 },
];

const ZONE_LABEL: Record<string, string> = { ob: '+ ob', os: '− os', mid: '· mid' };

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: PsoSort;
  label: string;
  align: 'left' | 'right';
  sort: PsoSort;
  onSort: (c: PsoSort) => void;
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

function zoneClass(zone: string) {
  return zone === 'ob' ? 'text-term-down' : zone === 'os' ? 'text-term-up' : 'text-term-dim';
}

export function PremierStochModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [lenIdx, setLenIdx] = useState(0); // default length 8
  const [sort, setSort] = useState<PsoSort>('pso');
  const len = LENGTHS[lenIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })) as PsoBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as PsoBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? psoBoard(data, sort, len.length, SMOOTH) : []), [data, sort, len.length]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Premier Stochastic.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Premier Stochastic · length {len.label} · smooth 5 · OB ±0.9</span>
        <div className="ml-auto flex gap-1">
          {LENGTHS.map((l, i) => (
            <button
              key={l.label}
              onClick={() => setLenIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === lenIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {l.label}
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
          <EmptyState>Not enough history to compute the Premier Stochastic.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="pso" label="PSO" align="right" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="Δ" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const slope = r.pso - r.prev;
                return (
                  <tr key={r.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 text-left">
                      <button
                        onClick={() => navigate(panel, r.symbol)}
                        className="no-drag text-term-text hover:text-term-amber"
                      >
                        {base(r.symbol)}
                      </button>
                    </td>
                    <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.pso)}`}>
                      {r.pso > 0 ? '+' : ''}
                      {r.pso.toFixed(3)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${r.dir === 'up' ? 'text-term-up' : 'text-term-down'}`}>
                      {slope > 0 ? '+' : ''}
                      {slope.toFixed(3)}
                    </td>
                    <td className={`px-2 py-0.5 text-center ${zoneClass(r.zone)}`}>{ZONE_LABEL[r.zone]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        PSO = tanh of double-EMA(normalised stochastic) · <span className="text-term-down">≥ +0.9 OB</span> /{' '}
        <span className="text-term-up">≤ −0.9 OS</span> · Δ = bar-over-bar change
      </div>
    </div>
  );
}
