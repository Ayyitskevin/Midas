import { useMemo, useState } from 'react';
import type { OrderBook } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { liquidity, sortLiquidity, type LiquidityRow, type LiquiditySort } from '@/lib/liquidity';
import { fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 16;
const LEVEL_OPTS = [10, 25];
const base = (sym: string) => sym.replace(/\/.*$/, '');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: LiquiditySort;
  label: string;
  align: 'left' | 'right';
  sort: LiquiditySort;
  onSort: (c: LiquiditySort) => void;
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

export function LiquidityModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [levels, setLevels] = useState(10);
  const [sort, setSort] = useState<LiquiditySort>('spread');

  const symbols = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        symbols.map((s) =>
          api
            .orderbook(s, 25, signal)
            .then((book) => ({ symbol: s, book: book as OrderBook | null }))
            .catch(() => ({ symbol: s, book: null as OrderBook | null })),
        ),
      ),
    [symbols.join(',')],
    { intervalMs: 8000, enabled: symbols.length > 0 },
  );

  const rows = useMemo(() => {
    const out: LiquidityRow[] = [];
    for (const d of data ?? []) {
      if (!d.book) continue;
      const r = liquidity(d.symbol, d.book, levels);
      if (r) out.push(r);
    }
    return sortLiquidity(out, sort);
  }, [data, levels, sort]);

  const maxSpread = useMemo(() => Math.max(1e-9, ...rows.map((r) => r.spreadBps)), [rows]);
  const maxDepth = useMemo(() => Math.max(1, ...rows.map((r) => r.totalDepth)), [rows]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank their liquidity.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">liquidity · spread &amp; top-{levels} depth</span>
        <div className="ml-auto flex gap-1">
          {LEVEL_OPTS.map((l) => (
            <button
              key={l}
              onClick={() => setLevels(l)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                levels === l ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading books" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>No two-sided books to rank.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="spread" label="SPREAD bps" align="right" sort={sort} onSort={setSort} />
                <SortHead col="depth" label="DEPTH $" align="right" sort={sort} onSort={setSort} />
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
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{ width: `${(r.spreadBps / maxSpread) * 100}%`, background: 'rgba(239,77,86,0.12)' }}
                    />
                    <span className="relative text-term-text">{r.spreadBps.toFixed(1)}</span>
                  </td>
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{ width: `${(r.totalDepth / maxDepth) * 100}%`, background: 'rgba(38,194,129,0.12)' }}
                    />
                    <span className="relative text-term-text">${fmtCompact(r.totalDepth)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Spread = (ask − bid) ÷ mid in bps (tighter = cheaper) · depth = resting notional in the top {levels} levels
      </div>
    </div>
  );
}
