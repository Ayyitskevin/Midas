import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { rmiBoard, type RmiSort } from '@/lib/rmi';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Altman defaults: length 20, momentum 5.
const PRESETS: { label: string; length: number; momentum: number }[] = [
  { label: '20·5', length: 20, momentum: 5 },
  { label: '14·3', length: 14, momentum: 3 },
];

const ZONE_LABEL: Record<string, string> = { ob: '+ ob', os: '− os', mid: '· mid' };

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: RmiSort;
  label: string;
  align: 'left' | 'right';
  sort: RmiSort;
  onSort: (c: RmiSort) => void;
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

// Mean-reversion coloring: oversold reads bullish, overbought bearish.
function rmiClass(zone: string) {
  return zone === 'os' ? 'text-term-up' : zone === 'ob' ? 'text-term-down' : 'text-term-text';
}

export function RmiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [preIdx, setPreIdx] = useState(0); // default 20·5
  const [sort, setSort] = useState<RmiSort>('rmi');
  const pre = PRESETS[preIdx];

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
    () => (data ? rmiBoard(data, sort, pre.length, pre.momentum) : []),
    [data, sort, pre.length, pre.momentum],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Relative Momentum Index.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Relative Momentum Index · length·momentum {pre.label} · OB 70/30</span>
        <div className="ml-auto flex gap-1">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPreIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === preIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
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
          <EmptyState>Not enough history to compute the RMI.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="rmi" label="RMI" align="right" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="Δ" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const slope = r.rmi - r.prev;
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
                    <td className={`px-2 py-0.5 text-right font-semibold ${rmiClass(r.zone)}`}>
                      {r.rmi.toFixed(1)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${r.dir === 'up' ? 'text-term-up' : 'text-term-down'}`}>
                      {slope > 0 ? '+' : ''}
                      {slope.toFixed(1)}
                    </td>
                    <td className={`px-2 py-0.5 text-center ${rmiClass(r.zone)}`}>{ZONE_LABEL[r.zone]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        RMI = RSI over an {pre.momentum}-bar momentum · <span className="text-term-up">&lt; 30 oversold</span> /{' '}
        <span className="text-term-down">&gt; 70 overbought</span> · Δ = bar-over-bar change
      </div>
    </div>
  );
}
