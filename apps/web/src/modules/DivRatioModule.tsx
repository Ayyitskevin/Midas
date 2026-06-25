import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { diversification } from '@/lib/diversification';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const ANN = Math.sqrt(365);
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

export function DivRatioModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
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

  const result = useMemo(() => (data ? diversification(data) : null), [data]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to measure the equal-weight book's diversification.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">diversification · equal-weight · {result?.n ?? 0} assets</span>
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

      {loading && !data ? (
        <Loading label="Loading history" />
      ) : error && !data ? (
        <ErrorMsg message={error} onRetry={refresh} />
      ) : !result || !result.ok ? (
        <EmptyState>Not enough history to measure diversification.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 border-b border-term-border px-2 py-1.5 sm:grid-cols-4">
            <Stat label="Div ratio" value={result.divRatio!.toFixed(2)} accent="text-term-amber" />
            <Stat label="Eff. bets" value={`${result.effectiveBets!.toFixed(1)} / ${result.n}`} />
            <Stat label="Avg vol" value={`${(result.weightedAvgVol * ANN * 100).toFixed(0)}%`} />
            <Stat
              label="Book vol"
              value={`${(result.portVol * ANN * 100).toFixed(0)}%`}
              accent="text-term-up"
            />
          </div>

          <div className="scroll-term min-h-0 flex-1 overflow-auto">
            <table className="w-full text-2xs tabular-nums">
              <thead className="sticky top-0 bg-term-panel">
                <tr>
                  <th className="px-2 py-1 text-left font-normal text-term-muted">SYMBOL</th>
                  <th className="px-2 py-1 text-right font-normal text-term-muted">VOL</th>
                  <th className="px-2 py-1 text-right font-normal text-term-muted">WEIGHT</th>
                </tr>
              </thead>
              <tbody>
                {result.assets.map((r) => (
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
                    <td className="px-2 py-0.5 text-right text-term-dim">{(r.weight * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
            DR = Σ wᵢσᵢ ÷ book vol · 1 = none, higher = more · DR² ≈ effective independent bets · annualized
          </div>
        </>
      )}
    </div>
  );
}
