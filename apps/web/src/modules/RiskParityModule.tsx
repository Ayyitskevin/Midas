import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { riskParity } from '@/lib/riskParity';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const ANN = Math.sqrt(365);
const base = (sym: string) => sym.replace(/\/.*$/, '');
type Sort = 'weight' | 'vol' | 'symbol';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: Sort;
  label: string;
  align: 'left' | 'right';
  sort: Sort;
  onSort: (c: Sort) => void;
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

export function RiskParityModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [sort, setSort] = useState<Sort>('weight');

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

  const result = useMemo(() => (data ? riskParity(data) : { rows: [], n: 0 }), [data]);
  const rows = useMemo(() => {
    const r = [...result.rows];
    if (sort === 'vol') r.sort((a, b) => b.vol - a.vol);
    else if (sort === 'symbol') r.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else r.sort((a, b) => b.weight - a.weight);
    return r;
  }, [result, sort]);
  const maxWeight = useMemo(() => Math.max(0.01, ...rows.map((r) => r.weight)), [rows]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to compute risk-parity (inverse-vol) weights.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">risk parity · inverse-vol · {result.n} assets</span>
        <span className="ml-auto text-term-dim">daily · 1Y</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to weight by volatility.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="vol" label="VOL" align="right" sort={sort} onSort={setSort} />
                <SortHead col="weight" label="WEIGHT" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">vs EQ</th>
                <th className="px-2 py-1 text-right font-normal text-term-muted">RISK</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = (r.weight - r.equalWeight) * 100;
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
                    <td className="px-2 py-0.5 text-right text-term-muted">{(r.vol * ANN * 100).toFixed(0)}%</td>
                    <td className="relative px-2 py-0.5 text-right">
                      <div
                        className="absolute inset-y-0 right-0 bg-term-amber/15"
                        style={{ width: `${(r.weight / maxWeight) * 100}%` }}
                      />
                      <span className="relative font-semibold text-term-amber">{(r.weight * 100).toFixed(1)}%</span>
                    </td>
                    <td className={`px-2 py-0.5 text-right ${diff >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                      {diff >= 0 ? '+' : ''}
                      {diff.toFixed(1)}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{r.riskContribPct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Weights ∝ 1/volatility so each name contributes equal risk · vs EQ = over/underweight vs 1/N · feed into REBAL
      </div>
    </div>
  );
}
