import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { stretchBoard, type StretchSort, type StretchLabel } from '@/lib/stretch';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const WINDOWS = [20, 50, 100];
const base = (sym: string) => sym.replace(/\/.*$/, '');

const LABEL_CHIP: Record<StretchLabel, { text: string; cls: string }> = {
  overbought: { text: 'OB', cls: 'text-term-down' },
  oversold: { text: 'OS', cls: 'text-term-up' },
  neutral: { text: '—', cls: 'text-term-dim' },
};

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: StretchSort;
  label: string;
  align: 'left' | 'right';
  sort: StretchSort;
  onSort: (c: StretchSort) => void;
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

export function StretchModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [window, setWindow] = useState(20);
  const [sort, setSort] = useState<StretchSort>('zscore');

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, '1d', '1y', signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? stretchBoard(data, window, sort) : []), [data, window, sort]);
  const maxAbsZ = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.zscore))), [rows]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to scan how stretched they are from their MA.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">stretch vs MA({window}) · daily</span>
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                w === window ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {w}
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
          <EmptyState>Not enough history for a {window}-day window.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="distance" label="DIST" align="right" sort={sort} onSort={setSort} />
                <SortHead col="zscore" label="Z" align="right" sort={sort} onSort={setSort} />
                <SortHead col="percentB" label="%B" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">FLAG</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const half = Math.min(50, (Math.abs(r.zscore) / maxAbsZ) * 50);
                const chip = LABEL_CHIP[r.label];
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
                    <td className={`px-2 py-0.5 text-right ${r.distancePct >= 0 ? 'text-term-down' : 'text-term-up'}`}>
                      {fmtSignedPercent(r.distancePct)}
                    </td>
                    <td className="relative px-2 py-0.5 text-right">
                      <div
                        className="absolute inset-y-0"
                        style={{
                          left: r.zscore >= 0 ? '50%' : `${50 - half}%`,
                          width: `${half}%`,
                          background: r.zscore >= 0 ? 'rgba(239,77,86,0.18)' : 'rgba(38,194,129,0.18)',
                        }}
                      />
                      <span className={`relative font-semibold ${r.zscore >= 0 ? 'text-term-down' : 'text-term-up'}`}>
                        {r.zscore >= 0 ? '+' : ''}
                        {r.zscore.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{r.percentB.toFixed(2)}</td>
                    <td className={`px-2 py-0.5 text-right font-semibold ${chip.cls}`}>{chip.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        z = price distance from the {window}-day MA in σ · %B = position in the ±2σ bands ·{' '}
        <span className="text-term-down">OB</span> above, <span className="text-term-up">OS</span> below
      </div>
    </div>
  );
}
