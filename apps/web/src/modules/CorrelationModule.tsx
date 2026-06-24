import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { correlationMatrix, corrColor, type CorrSeries } from '@/lib/correlation';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 12;

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const base = (sym: string) => sym.replace(/\/.*$/, '');

export function CorrelationModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const symbols = useMemo(() => watchlist.slice(0, MAX), [watchlist]);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const tf = TIMEFRAMES[tfIdx];

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
    { enabled: symbols.length >= 2 },
  );

  const { syms, matrix } = useMemo(() => {
    const valid = (data ?? []).filter((d) => d.closes.length >= 3);
    if (valid.length < 2) return { syms: [] as string[], matrix: [] as number[][] };
    const k = Math.min(...valid.map((d) => d.closes.length));
    const aligned: CorrSeries[] = valid.map((d) => ({ symbol: d.symbol, closes: d.closes.slice(-k) }));
    return { syms: aligned.map((a) => a.symbol), matrix: correlationMatrix(aligned) };
  }, [data]);

  if (symbols.length < 2) {
    return <EmptyState>Add at least two watchlist symbols (W) to see correlations.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">
          return correlation · {syms.length}×{syms.length}
        </span>
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

      <div className="scroll-term min-h-0 flex-1 overflow-auto p-2">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : syms.length < 2 ? (
          <EmptyState>Not enough overlapping history to correlate.</EmptyState>
        ) : (
          <table className="border-collapse text-2xs tabular-nums">
            <thead>
              <tr>
                <th className="p-1" />
                {syms.map((s) => (
                  <th key={s} className="p-1 font-normal text-term-muted">
                    <button onClick={() => navigate(panel, s)} className="no-drag hover:text-term-amber">
                      {base(s)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {syms.map((s, i) => (
                <tr key={s}>
                  <th className="p-1 text-right font-normal text-term-muted">
                    <button onClick={() => navigate(panel, s)} className="no-drag hover:text-term-amber">
                      {base(s)}
                    </button>
                  </th>
                  {syms.map((s2, j) => {
                    const r = matrix[i][j];
                    return (
                      <td
                        key={s2}
                        title={`${base(s)} · ${base(s2)} = ${r.toFixed(2)}`}
                        className="border border-term-bg p-1 text-center text-term-text"
                        style={{ backgroundColor: corrColor(r) }}
                      >
                        {i === j ? '1' : r.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
