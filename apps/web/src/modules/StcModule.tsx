import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { stcBoard, type StcSort } from '@/lib/stc';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Schaff defaults: fast 23 / slow 50 / cycle 10 / smoothing 0.5.
const FAST = 23;
const SLOW = 50;
const FACTOR = 0.5;

const CYCLES: { label: string; cycle: number }[] = [
  { label: '10', cycle: 10 },
  { label: '23', cycle: 23 },
];

const ZONE_LABEL: Record<string, string> = { bull: '▲ bull', bear: '▼ bear', mid: '· mid' };

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: StcSort;
  label: string;
  align: 'left' | 'right';
  sort: StcSort;
  onSort: (c: StcSort) => void;
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
  return zone === 'bull' ? 'text-term-up' : zone === 'bear' ? 'text-term-down' : 'text-term-dim';
}

export function StcModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [cycIdx, setCycIdx] = useState(0); // default cycle 10
  const [sort, setSort] = useState<StcSort>('stc');
  const cyc = CYCLES[cycIdx];

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
    () => (data ? stcBoard(data, sort, FAST, SLOW, cyc.cycle, FACTOR) : []),
    [data, sort, cyc.cycle],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Schaff Trend Cycle.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Schaff Trend Cycle · 23/50 MACD · cycle {cyc.label}</span>
        <div className="ml-auto flex gap-1">
          {CYCLES.map((c, i) => (
            <button
              key={c.label}
              onClick={() => setCycIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === cycIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {c.label}
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
          <EmptyState>Not enough history to compute the STC.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="stc" label="STC" align="right" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="Δ" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const slope = r.stc - r.prev;
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
                    <td className={`px-2 py-0.5 text-right font-semibold ${zoneClass(r.zone)}`}>
                      {r.stc.toFixed(1)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${r.dir === 'up' ? 'text-term-up' : 'text-term-down'}`}>
                      {slope > 0 ? '+' : ''}
                      {slope.toFixed(1)}
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
        STC = double-stochastic of the 23/50 MACD, 0–100 · <span className="text-term-up">≥ 75 bull</span> /{' '}
        <span className="text-term-down">≤ 25 bear</span> · Δ = bar-over-bar change
      </div>
    </div>
  );
}
