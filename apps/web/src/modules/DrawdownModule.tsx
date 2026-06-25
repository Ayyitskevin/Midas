import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { drawdownBoard, type DrawdownSort } from '@/lib/drawdown';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const SPARK_W = 84;
const SPARK_H = 22;

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const base = (sym: string) => sym.replace(/\/.*$/, '');

/** Mini underwater area: 0 at the top (peaks), the curve dipping below. */
function Underwater({ dd, minDD }: { dd: number[]; minDD: number }) {
  if (dd.length < 2 || minDD >= 0) {
    return (
      <svg width={SPARK_W} height={SPARK_H} className="block">
        <line x1={0} x2={SPARK_W} y1={1} y2={1} stroke="rgba(122,127,135,0.5)" strokeWidth={1} />
      </svg>
    );
  }
  const n = dd.length;
  const xAt = (i: number) => (i / (n - 1)) * SPARK_W;
  const yAt = (d: number) => Math.min(SPARK_H, Math.max(0, (d / minDD) * (SPARK_H - 1)));
  const curve = dd.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d).toFixed(1)}`).join(' ');
  const area = `M 0,0 L ${curve} L ${SPARK_W},0 Z`;
  return (
    <svg width={SPARK_W} height={SPARK_H} className="block">
      <path d={area} fill="rgba(239,77,86,0.18)" />
      <polyline points={curve} fill="none" stroke="rgba(239,77,86,0.85)" strokeWidth={1} />
    </svg>
  );
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: DrawdownSort;
  label: string;
  align: 'left' | 'right';
  sort: DrawdownSort;
  onSort: (c: DrawdownSort) => void;
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

export function DrawdownModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const [sort, setSort] = useState<DrawdownSort>('maxDD');
  const tf = TIMEFRAMES[tfIdx];

  const symbols = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        symbols.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [symbols.join(','), tf.interval, tf.range],
    { enabled: symbols.length > 0 },
  );

  const rows = useMemo(() => (data ? drawdownBoard(data, sort) : []), [data, sort]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to monitor drawdowns.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">drawdown from peak · daily</span>
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
          <EmptyState>Not enough history to compute drawdowns.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">UNDERWATER</th>
                <SortHead col="maxDD" label="MAX DD" align="right" sort={sort} onSort={setSort} />
                <SortHead col="curDD" label="CUR DD" align="right" sort={sort} onSort={setSort} />
                <SortHead col="underwater" label="UW" align="right" sort={sort} onSort={setSort} />
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
                    <Underwater dd={r.dd} minDD={r.maxDD} />
                  </td>
                  <td className="px-2 py-0.5 text-right font-semibold text-term-down">
                    {fmtSignedPercent(r.maxDD * 100, 1)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${r.curDD < 0 ? 'text-term-down' : 'text-term-muted'}`}>
                    {r.curDD < 0 ? fmtSignedPercent(r.curDD * 100, 1) : 'at high'}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.underwater}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Drawdown = decline from the running peak · UW = days since the last high · sparkline 0 (top) → trough
      </div>
    </div>
  );
}
