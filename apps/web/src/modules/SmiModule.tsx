import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { smiBoard, type SmiSort, type SmiBar } from '@/lib/smi';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// TradingView SMI smoothing defaults: %D length 3 (both passes) and EMA signal 3.
const SMOOTH = 3;
const SIGNAL = 3;

const LENGTHS: { label: string; lengthK: number }[] = [
  { label: '10', lengthK: 10 },
  { label: '14', lengthK: 14 },
];

const ZONE_LABEL: Record<string, string> = { ob: '+ ob', os: '− os', mid: '· mid' };

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: SmiSort;
  label: string;
  align: 'left' | 'right';
  sort: SmiSort;
  onSort: (c: SmiSort) => void;
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

export function SmiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [lenIdx, setLenIdx] = useState(0); // default %K 10
  const [sort, setSort] = useState<SmiSort>('smi');
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
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })) as SmiBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as SmiBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? smiBoard(data, sort, len.lengthK, SMOOTH, SMOOTH, SIGNAL) : []),
    [data, sort, len.lengthK],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Stochastic Momentum Index.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Stochastic Momentum Index · %K {len.label} · 3/3 smooth · OB ±40</span>
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
          <EmptyState>Not enough history to compute the SMI.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="smi" label="SMI" align="right" sort={sort} onSort={setSort} />
                <SortHead col="hist" label="Δ SIG" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cross = r.dir === 'up';
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
                    <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.smi)}`}>
                      {r.smi > 0 ? '+' : ''}
                      {r.smi.toFixed(1)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${cross ? 'text-term-up' : 'text-term-down'}`}>
                      {r.hist > 0 ? '+' : ''}
                      {r.hist.toFixed(1)}
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
        SMI = 200 · dbl-EMA(close − midrange) ÷ dbl-EMA(range) · <span className="text-term-up">▲ above signal</span> /{' '}
        <span className="text-term-down">▼ below</span> · ±40 = OB / OS
      </div>
    </div>
  );
}
