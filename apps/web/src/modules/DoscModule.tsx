import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { doscBoard, type DoscSort } from '@/lib/dosc';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Brown defaults: RSI 14, signal SMA 9.
const RSI_LEN = 14;
const SIG_LEN = 9;

const PRESETS: { label: string; s1: number; s2: number }[] = [
  { label: '5·3', s1: 5, s2: 3 },
  { label: '7·5', s1: 7, s2: 5 },
];

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: DoscSort;
  label: string;
  align: 'left' | 'right';
  sort: DoscSort;
  onSort: (c: DoscSort) => void;
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

export function DoscModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [preIdx, setPreIdx] = useState(0); // default 5·3
  const [sort, setSort] = useState<DoscSort>('dosc');
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
    () => (data ? doscBoard(data, sort, RSI_LEN, pre.s1, pre.s2, SIG_LEN) : []),
    [data, sort, pre.s1, pre.s2],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Derivative Oscillator.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Derivative Osc · RSI 14 · smooth {pre.label} · signal SMA 9</span>
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
          <EmptyState>Not enough history to compute the Derivative Oscillator.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="dosc" label="DOSC" align="right" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="Δ" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">STATE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rising = r.dir === 'up';
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
                    <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.dosc)}`}>
                      {r.dosc > 0 ? '+' : ''}
                      {r.dosc.toFixed(2)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${rising ? 'text-term-up' : 'text-term-down'}`}>
                      {rising ? '▲' : '▼'}
                    </td>
                    <td
                      className={`px-2 py-0.5 text-center ${r.side === 'pos' ? 'text-term-up' : 'text-term-down'}`}
                    >
                      {r.side === 'pos' ? '+ bull' : '− bear'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        DOSC = double-EMA(RSI) − its 9-SMA · <span className="text-term-up">+ above zero</span> /{' '}
        <span className="text-term-down">− below</span> · ▲▼ = histogram rising/falling
      </div>
    </div>
  );
}
