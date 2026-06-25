import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { efficiencyBoard, type EfficiencySort } from '@/lib/efficiency';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const WINDOWS = [10, 20, 50];
const base = (sym: string) => sym.replace(/\/.*$/, '');

const dirArrow = (d: number) => (d > 0 ? '▲' : d < 0 ? '▼' : '–');
const dirColor = (d: number) => (d > 0 ? 'text-term-up' : d < 0 ? 'text-term-down' : 'text-term-muted');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: EfficiencySort;
  label: string;
  align: 'left' | 'right';
  sort: EfficiencySort;
  onSort: (c: EfficiencySort) => void;
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

export function EfficiencyModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [window, setWindow] = useState(20);
  const [sort, setSort] = useState<EfficiencySort>('er');

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

  const rows = useMemo(() => (data ? efficiencyBoard(data, window, sort) : []), [data, window, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank trend efficiency (signal vs noise).</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">efficiency ratio · {window}d · daily</span>
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                w === window ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {w}d
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
                <th className="px-2 py-1 text-left font-normal text-term-muted">ER (0 ··· 1)</th>
                <SortHead col="er" label="ER" align="right" sort={sort} onSort={setSort} />
                <SortHead col="change" label="CHG" align="right" sort={sort} onSort={setSort} />
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
                  <td className="px-2 py-0.5">
                    <div className="relative h-3 w-full rounded-sm bg-term-bg/60">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${Math.max(2, r.er * 100)}%`,
                          background:
                            r.direction > 0
                              ? 'rgba(38,194,129,0.35)'
                              : r.direction < 0
                                ? 'rgba(239,77,86,0.35)'
                                : 'rgba(122,127,135,0.3)',
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-0.5 text-right font-semibold text-term-text">{r.er.toFixed(2)}</td>
                  <td className={`px-2 py-0.5 text-right ${dirColor(r.direction)}`}>
                    <span className="mr-1">{dirArrow(r.direction)}</span>
                    {fmtSignedPercent(r.changePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        ER → 1 is a clean, efficient trend · ER → 0 is choppy / mean-reverting noise
      </div>
    </div>
  );
}
