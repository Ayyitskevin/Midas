import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { maxSharpe } from '@/lib/maxSharpe';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const ANN = Math.sqrt(365);
const base = (sym: string) => sym.replace(/\/.*$/, '');
type Sort = 'weight' | 'sharpe' | 'symbol';

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

export function MaxSharpeModule({ panel }: ModuleProps) {
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

  const result = useMemo(() => (data ? maxSharpe(data) : null), [data]);
  const rows = useMemo(() => {
    if (!result) return [];
    const r = [...result.rows];
    if (sort === 'sharpe') r.sort((a, b) => b.sharpe - a.sharpe);
    else if (sort === 'symbol') r.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else r.sort((a, b) => b.weight - a.weight);
    return r;
  }, [result, sort]);
  const maxAbsW = useMemo(
    () => Math.max(0.01, ...rows.map((r) => Math.abs(r.weight))),
    [rows],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to compute the max-Sharpe (tangency) weights.</EmptyState>;
  }

  // Daily Sharpe → annualized by √periods.
  const annSharpe = (s: number) => (s * ANN).toFixed(2);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">
          max-Sharpe · tangency · {result?.n ?? 0} assets{result && !result.ok ? ' · equal-wt fallback' : ''}
        </span>
        <span className="ml-auto text-term-dim">daily · 1Y</span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to build a covariance matrix.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="sharpe" label="SHARPE" align="right" sort={sort} onSort={setSort} />
                <SortHead col="weight" label="MAX-SR" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">vs EQ</th>
                <th className="px-2 py-1 text-right font-normal text-term-muted">VOL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = (r.weight - r.equalWeight) * 100;
                const neg = r.weight < 0;
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
                    <td className={`px-2 py-0.5 text-right ${r.sharpe >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                      {annSharpe(r.sharpe)}
                    </td>
                    <td className="relative px-2 py-0.5 text-right">
                      <div
                        className={`absolute inset-y-0 right-0 ${neg ? 'bg-term-down/15' : 'bg-term-amber/15'}`}
                        style={{ width: `${(Math.abs(r.weight) / maxAbsW) * 100}%` }}
                      />
                      <span className={`relative font-semibold ${neg ? 'text-term-down' : 'text-term-amber'}`}>
                        {(r.weight * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className={`px-2 py-0.5 text-right ${diff >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                      {diff >= 0 ? '+' : ''}
                      {diff.toFixed(1)}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{(r.vol * ANN * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {result && rows.length > 0 && (
        <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          <div className="flex items-center gap-3">
            <span>
              Sharpe: <span className="font-semibold text-term-up">{annSharpe(result.portSharpe)}</span> tangency
            </span>
            <span>vs {annSharpe(result.equalSharpe)} equal</span>
            <span>exp {(result.portReturn * 365 * 100).toFixed(0)}% · vol {(result.portVol * ANN * 100).toFixed(0)}%</span>
            {result.hasShort && <span className="ml-auto text-term-down">shorts (neg wt)</span>}
          </div>
          <div className="mt-0.5">
            Σ⁻¹·(μ−rf) / 1ᵀΣ⁻¹·(μ−rf) — highest risk-adjusted-return fully-invested book · annualized · feed into REBAL
          </div>
        </div>
      )}
    </div>
  );
}
