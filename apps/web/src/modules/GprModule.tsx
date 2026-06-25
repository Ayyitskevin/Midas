import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { gprBoard, type GprSort } from '@/lib/gainToPain';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

const gprColor = (v: number | null) =>
  v == null ? 'text-term-up' : v >= 1 ? 'text-term-up' : v >= 0 ? 'text-term-text' : 'text-term-down';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: GprSort;
  label: string;
  align: 'left' | 'right';
  sort: GprSort;
  onSort: (c: GprSort) => void;
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

export function GprModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
  const [sort, setSort] = useState<GprSort>('gpr');
  const tf = TIMEFRAMES[tfIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

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

  const rows = useMemo(() => (data ? gprBoard(data, sort) : []), [data, sort]);
  const maxAbs = useMemo(
    () => Math.max(1, ...rows.map((r) => (r.gpr == null ? 0 : Math.abs(r.gpr)))),
    [rows],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank return quality by Gain-to-Pain.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Gain-to-Pain · {tf.label} daily</span>
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
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to compute Gain-to-Pain.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="gpr" label="GPR" align="right" sort={sort} onSort={setSort} />
                <SortHead col="totalReturn" label="ΣRET" align="right" sort={sort} onSort={setSort} />
                <SortHead col="up" label="UP%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">PAIN</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const upPct = r.n > 0 ? (r.up / r.n) * 100 : 0;
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
                    <td className="relative px-2 py-0.5 text-right">
                      <div
                        className="absolute inset-y-0 right-0"
                        style={{
                          width: `${r.gpr == null ? 100 : (Math.abs(r.gpr) / maxAbs) * 100}%`,
                          background: (r.gpr ?? 1) >= 0 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
                        }}
                      />
                      <span className={`relative font-semibold ${gprColor(r.gpr)}`}>
                        {r.gpr == null ? '∞' : r.gpr.toFixed(2)}
                      </span>
                    </td>
                    <td className={`px-2 py-0.5 text-right ${r.totalReturn >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                      {fmtSignedPercent(r.totalReturn * 100)}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{upPct.toFixed(0)}%</td>
                    <td className="px-2 py-0.5 text-right text-term-down">{(r.pain * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        GPR = Σ returns ÷ Σ losses · ≥1 good, ≥2 excellent · <span className="text-term-up">∞</span> = no losing days · ΣRET / PAIN summed over the window
      </div>
    </div>
  );
}
