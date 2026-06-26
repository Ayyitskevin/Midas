import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { appraisalBoard, type AppraisalSort } from '@/lib/appraisal';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const MAX = 20;
const PERIODS_PER_YEAR = 365;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const apprColor = (v: number | null) =>
  v == null ? 'text-term-muted' : v >= 0 ? 'text-term-up' : 'text-term-down';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: AppraisalSort;
  label: string;
  align: 'left' | 'right';
  sort: AppraisalSort;
  onSort: (c: AppraisalSort) => void;
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

export function AppraisalModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<AppraisalSort>('appraisal');
  const tf = TIMEFRAMES[tfIdx];

  // Always fetch BTC as the benchmark, plus the watchlist symbols (deduped).
  const fetchSyms = useMemo(() => Array.from(new Set([BENCH, ...watchlist.slice(0, MAX)])), [watchlist]);

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

  const rows = useMemo(
    () => (data ? appraisalBoard(data, BENCH, PERIODS_PER_YEAR, sort) : []),
    [data, sort],
  );
  const maxAbs = useMemo(
    () => Math.max(0.5, ...rows.map((r) => (r.appraisal == null ? 0 : Math.abs(r.appraisal)))),
    [rows],
  );
  const benchMissing = useMemo(
    () => Boolean(data) && !data!.find((d) => d.symbol === BENCH)?.closes.length,
    [data],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank their appraisal ratio vs BTC.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">appraisal vs {base(BENCH)} · daily · annualized</span>
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
          <EmptyState>No BTC history to benchmark against.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>Add non-BTC watchlist symbols to compare.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="appraisal" label="APPR" align="right" sort={sort} onSort={setSort} />
                <SortHead col="alpha" label="ALPHA" align="right" sort={sort} onSort={setSort} />
                <SortHead col="residualVol" label="IVOL" align="right" sort={sort} onSort={setSort} />
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
                        width: `${r.appraisal == null ? 0 : (Math.abs(r.appraisal) / maxAbs) * 100}%`,
                        background: (r.appraisal ?? 0) >= 0 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
                      }}
                    />
                    <span className={`relative font-semibold ${apprColor(r.appraisal)}`}>
                      {r.appraisal == null ? '—' : r.appraisal.toFixed(2)}
                    </span>
                  </td>
                  <td className={`px-2 py-0.5 text-right ${r.alpha >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                    {fmtSignedPercent(r.alpha * 100)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.residualVol * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        appraisal = Jensen's α ÷ idiosyncratic vol · alpha per unit of name-specific (residual) risk · higher is better · IVOL = residual stdev
      </div>
    </div>
  );
}
