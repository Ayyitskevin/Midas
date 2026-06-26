import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { dualBetaBoard, type DualBetaSort } from '@/lib/dualBeta';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BTC = 'BTC/USDT';
const ETH = 'ETH/USDT';
const MAX = 20;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const signColor = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: DualBetaSort;
  label: string;
  align: 'left' | 'right';
  sort: DualBetaSort;
  onSort: (c: DualBetaSort) => void;
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

export function BetaEthModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<DualBetaSort>('betaEth');
  const tf = TIMEFRAMES[tfIdx];

  // Always fetch BOTH majors as benchmarks, plus the watchlist symbols (deduped).
  const fetchSyms = useMemo(
    () => Array.from(new Set([BTC, ETH, ...watchlist.slice(0, MAX)])),
    [watchlist],
  );

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(','), tf.interval, tf.range],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? dualBetaBoard(data, BTC, ETH, sort) : []), [data, sort]);
  const maxAbs = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.betaEth))), [rows]);
  const benchMissing = useMemo(
    () =>
      Boolean(data) &&
      (!data!.find((d) => d.symbol === BTC)?.closes.length ||
        !data!.find((d) => d.symbol === ETH)?.closes.length),
    [data],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to compare their ETH-beta vs BTC-beta.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">β vs ETH / BTC · {tf.label} daily</span>
        <div className="ml-auto flex gap-1">
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : benchMissing ? (
          <EmptyState>Need both BTC and ETH history to compare.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>Add non-BTC/ETH watchlist symbols to compare.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="betaEth" label="βETH" align="right" sort={sort} onSort={setSort} />
                <SortHead col="betaBtc" label="βBTC" align="right" sort={sort} onSort={setSort} />
                <SortHead col="divergence" label="Δ" align="right" sort={sort} onSort={setSort} />
                <SortHead col="corrEth" label="rETH" align="right" sort={sort} onSort={setSort} />
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
                      style={{
                        width: `${(Math.abs(r.betaEth) / maxAbs) * 100}%`,
                        background: r.betaEth >= 0 ? 'rgba(76,194,255,0.12)' : 'rgba(239,77,86,0.12)',
                      }}
                    />
                    <span className={`relative font-semibold ${signColor(r.betaEth)}`}>{r.betaEth.toFixed(2)}</span>
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.betaBtc.toFixed(2)}</td>
                  <td className={`px-2 py-0.5 text-right ${signColor(r.divergence)}`}>
                    {r.divergence >= 0 ? '+' : ''}
                    {r.divergence.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.corrEth.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        β to each major over the same window · Δ = βETH − βBTC (+ leans ETH, − leans BTC) · rETH = correlation to ETH
      </div>
    </div>
  );
}
