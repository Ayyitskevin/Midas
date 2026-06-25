import { useMemo } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { computeSignals, type Trend, type RsiState } from '@/lib/signals';
import { mtfConsensus, type MtfVerdict } from '@/lib/mtf';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1H', interval: '60m', range: '1mo' },
  { label: '1D', interval: '1d', range: '1y' },
  { label: '1W', interval: '1wk', range: '2y' },
  { label: '1M', interval: '1mo', range: '5y' },
];

const VERDICT: Record<MtfVerdict, { label: string; color: string }> = {
  bullish: { label: 'aligned bullish', color: '#26c281' },
  bearish: { label: 'aligned bearish', color: '#ef4d56' },
  mixed: { label: 'mixed / chop', color: '#ffb000' },
  none: { label: 'no read', color: '#7a7f87' },
};

const trendColor = (t: Trend | null) =>
  t === 'up' ? 'text-term-up' : t === 'down' ? 'text-term-down' : 'text-term-muted';
const trendLabel = (t: Trend | null) => (t === 'up' ? '▲ up' : t === 'down' ? '▼ down' : '—');
const rsiColor = (s: RsiState | null) =>
  s === 'overbought' ? 'text-term-down' : s === 'oversold' ? 'text-term-up' : 'text-term-text';

export function MtfModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        TIMEFRAMES.map((tf) =>
          api
            .history(symbol!, tf.interval, tf.range, signal)
            .then((h) => ({ label: tf.label, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ label: tf.label, closes: [] as number[] })),
        ),
      ),
    [symbol],
    { enabled: !!symbol, intervalMs: 60_000 },
  );

  const frames = useMemo(
    () =>
      (data ?? []).map((d) => {
        const s = computeSignals(d.closes);
        return { label: d.label, trend: s?.trend ?? null, rsi: s?.rsi ?? null, rsiState: s?.rsiState ?? null };
      }),
    [data],
  );
  const consensus = useMemo(() => mtfConsensus(frames.map((f) => f.trend)), [frames]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  const v = VERDICT[consensus.verdict];

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center gap-2 text-2xs">
        <span className="text-term-dim">{base(symbol)} multi-timeframe trend</span>
      </div>

      {/* Consensus headline */}
      <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
        <div className="text-2xs uppercase tracking-wide text-term-dim">Consensus</div>
        <div className="font-mono text-lg font-semibold uppercase" style={{ color: v.color }}>
          {v.label}
        </div>
        <div className="text-2xs text-term-muted">
          {consensus.total > 0
            ? `${Math.max(consensus.up, consensus.down)} of ${consensus.total} frames · ${consensus.alignedPct.toFixed(0)}% aligned`
            : 'not enough history across timeframes'}
        </div>
      </div>

      {/* Per-timeframe rows */}
      <div className="rounded-sm border border-term-border">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 border-b border-term-border px-2 py-1 text-2xs uppercase tracking-wide text-term-dim">
          <span>TF</span>
          <span className="text-right">Trend</span>
          <span className="text-right">RSI</span>
        </div>
        {frames.map((f) => (
          <div
            key={f.label}
            className="grid grid-cols-[auto_1fr_1fr] gap-2 border-b border-term-border/30 px-2 py-1.5 font-mono text-xs tabular-nums last:border-0"
          >
            <span className="font-semibold text-term-text">{f.label}</span>
            <span className={`text-right font-semibold ${trendColor(f.trend)}`}>{trendLabel(f.trend)}</span>
            <span className={`text-right ${rsiColor(f.rsiState)}`}>
              {f.rsi == null ? '—' : f.rsi.toFixed(0)}
              {f.rsiState === 'overbought' && <span className="ml-1 text-2xs text-term-down">OB</span>}
              {f.rsiState === 'oversold' && <span className="ml-1 text-2xs text-term-up">OS</span>}
            </span>
          </div>
        ))}
      </div>

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Each timeframe's trend is SMA20 vs SMA50, RSI is 14-period. When higher timeframes agree with the lower
        ones the move is in gear; conflicts mean chop and lower-conviction signals.
      </p>
    </div>
  );
}
