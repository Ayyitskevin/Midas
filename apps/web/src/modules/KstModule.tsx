import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { kstBoard, type KstSort } from '@/lib/kst';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const SIGNALS: { label: string; period: number }[] = [
  { label: '9', period: 9 },
  { label: '6', period: 6 },
];

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: KstSort;
  label: string;
  align: 'left' | 'right';
  sort: KstSort;
  onSort: (c: KstSort) => void;
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

export function KstModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sigIdx, setSigIdx] = useState(0); // default signal 9
  const [sort, setSort] = useState<KstSort>('kst');
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

  const rows = useMemo(() => (data ? kstBoard(data, sort, sig.period) : []), [data, sort, sig.period]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Know Sure Thing.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Know Sure Thing · 10/15/20/30 ROC · signal {sig.label}</span>
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
          <EmptyState>Not enough history to compute the KST.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="kst" label="KST" align="right" sort={sort} onSort={setSort} />
                <SortHead col="hist" label="Δ SIG" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">STATE</th>
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
                    <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.kst)}`}>
                      {r.kst > 0 ? '+' : ''}
                      {r.kst.toFixed(1)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${cross ? 'text-term-up' : 'text-term-down'}`}>
                      {r.hist > 0 ? '+' : ''}
                      {r.hist.toFixed(1)}
                    </td>
                    <td className={`px-2 py-0.5 text-center ${cross ? 'text-term-up' : 'text-term-down'}`}>
                      {cross ? '▲' : '▼'} {r.side === 'pos' ? '+' : '−'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        KST = Σ wₖ·SMA(ROCₖ) · <span className="text-term-up">▲ above signal</span> /{' '}
        <span className="text-term-down">▼ below</span> · ± = above/below zero
      </div>
    </div>
  );
}
