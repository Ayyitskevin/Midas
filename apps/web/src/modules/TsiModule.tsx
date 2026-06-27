import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { tsiBoard, type TsiSort } from '@/lib/tsi';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Blau defaults: long 25 (slow / first smoothing), short 13 (fast / second).
const LONG = 25;
const SHORT = 13;

const SIGNALS: { label: string; period: number }[] = [
  { label: '7', period: 7 },
  { label: '13', period: 13 },
];

const ZONE_LABEL: Record<string, string> = { ob: '+ ob', os: '− os', mid: '· mid' };

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: TsiSort;
  label: string;
  align: 'left' | 'right';
  sort: TsiSort;
  onSort: (c: TsiSort) => void;
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
  return zone === 'ob' ? 'text-term-up' : zone === 'os' ? 'text-term-down' : 'text-term-dim';
}

export function TsiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sigIdx, setSigIdx] = useState(0); // default signal 7
  const [sort, setSort] = useState<TsiSort>('tsi');
  const sig = SIGNALS[sigIdx];

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
    () => (data ? tsiBoard(data, sort, LONG, SHORT, sig.period) : []),
    [data, sort, sig.period],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the True Strength Index.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">True Strength Index · 25/13 double-smoothed · signal {sig.label}</span>
        <div className="ml-auto flex gap-1">
          {SIGNALS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setSigIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === sigIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {s.label}
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
          <EmptyState>Not enough history to compute the TSI.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="tsi" label="TSI" align="right" sort={sort} onSort={setSort} />
                <SortHead col="hist" label="Δ SIG" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.tsi)}`}>
                    {r.tsi > 0 ? '+' : ''}
                    {r.tsi.toFixed(1)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${r.dir === 'up' ? 'text-term-up' : 'text-term-down'}`}>
                    {r.hist > 0 ? '+' : ''}
                    {r.hist.toFixed(1)}
                  </td>
                  <td className={`px-2 py-0.5 text-center ${zoneClass(r.zone)}`}>{ZONE_LABEL[r.zone]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        TSI = 100 · double-EMA(Δclose) ÷ double-EMA(|Δclose|) · <span className="text-term-up">&gt; 0 bull</span> /{' '}
        <span className="text-term-down">&lt; 0 bear</span> · Δ SIG = TSI − signal
      </div>
    </div>
  );
}
