import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { toReturns } from '@/lib/correlation';
import { rollingBeta, meanOf } from '@/lib/rollingBeta';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const WINDOWS = [14, 30, 60];
const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

const base = (sym: string) => sym.replace(/\/.*$/, '');

export function RollingBetaModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(1); // default 1Y
  const [window, setWindow] = useState(30);
  const tf = TIMEFRAMES[tfIdx];

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const [a, b] = await Promise.all([
        api.history(symbol!, tf.interval, tf.range, signal),
        api.history(BENCH, tf.interval, tf.range, signal),
      ]);
      return { a: a.candles.map((c) => c.close), b: b.candles.map((c) => c.close) };
    },
    [symbol, tf.interval, tf.range],
    { enabled: !!symbol },
  );

  const series = useMemo(() => {
    if (!data) return [];
    const k = Math.min(data.a.length, data.b.length);
    if (k < window + 1) return [];
    return rollingBeta(toReturns(data.a.slice(-k)), toReturns(data.b.slice(-k)), window);
  }, [data, window]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    if (series.length < 2 || size.w <= 0 || size.h <= 0) return null;
    const n = series.length;
    const padR = 30;
    const gap = 12;
    const pw = size.w - padR;
    const h1 = Math.floor((size.h - gap) * 0.6);
    const h2 = size.h - gap - h1;
    if (pw <= 10 || h1 <= 10 || h2 <= 10) return null;

    const betas = series.map((p) => p.beta);
    let lo = Math.min(0, ...betas);
    let hi = Math.max(1, ...betas);
    if (lo === hi) hi = lo + 1;
    const padv = (hi - lo) * 0.08;
    lo -= padv;
    hi += padv;
    const xAt = (i: number) => (i / (n - 1)) * pw;
    const yBeta = (v: number) => ((hi - v) / (hi - lo)) * h1;
    const yCorr = (v: number) => h1 + gap + ((1 - v) / 2) * h2; // corr ∈ [−1,1]

    const betaLine = series.map((p, i) => `${xAt(i).toFixed(1)},${yBeta(p.beta).toFixed(1)}`).join(' ');
    const corrLine = series.map((p, i) => `${xAt(i).toFixed(1)},${yCorr(p.correlation).toFixed(1)}`).join(' ');
    return { pw, h1, h2, gap, lo, hi, yBeta, yCorr, betaLine, corrLine, oneY: yBeta(1), zeroY: yBeta(0), corrZeroY: yCorr(0) };
  }, [series, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (series.length < 2) return <EmptyState>Not enough history for a rolling beta.</EmptyState>;

  const cur = series[series.length - 1];
  const betaColor = cur.beta < 0 ? 'text-term-down' : Math.abs(cur.beta) >= 1 ? 'text-term-amber' : 'text-term-up';

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">
          {base(symbol)} vs BTC · rolling {window}d
        </span>
        <div className="ml-auto flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`no-drag rounded-sm px-1 py-0.5 ${window === w ? 'text-term-amber' : 'text-term-muted hover:text-term-text'}`}
            >
              {w}
            </button>
          ))}
          <span className="mx-0.5 text-term-border">|</span>
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3 px-2 py-1 tabular-nums">
        <span className="text-term-muted">
          β <span className={`font-semibold ${betaColor}`}>{cur.beta.toFixed(2)}</span>
          <span className="text-term-dim"> (avg {meanOf(series, (p) => p.beta).toFixed(2)})</span>
        </span>
        <span className="text-term-muted">
          ρ <span className="text-term-accent">{cur.correlation.toFixed(2)}</span>
          <span className="text-term-dim"> (avg {meanOf(series, (p) => p.correlation).toFixed(2)})</span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {/* Beta pane */}
              <line x1={0} x2={view.pw} y1={view.oneY} y2={view.oneY} stroke="rgba(255,176,0,0.35)" strokeWidth={1} strokeDasharray="4 3" />
              <line x1={0} x2={view.pw} y1={view.zeroY} y2={view.zeroY} stroke="rgba(122,127,135,0.4)" strokeWidth={1} />
              <polyline points={view.betaLine} fill="none" stroke="rgba(255,176,0,0.95)" strokeWidth={1.25} />
              <text x={view.pw + 3} y={view.oneY + 3} fill="rgba(255,176,0,0.7)" style={{ fontSize: 8 }}>β=1</text>
              <text x={3} y={11} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>beta</text>

              {/* Correlation pane */}
              <line x1={0} x2={view.pw} y1={view.corrZeroY} y2={view.corrZeroY} stroke="rgba(122,127,135,0.4)" strokeWidth={1} />
              <polyline points={view.corrLine} fill="none" stroke="rgba(76,194,255,0.95)" strokeWidth={1.25} />
              <text x={view.pw + 3} y={view.corrZeroY + 3} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>0</text>
              <text x={3} y={view.h1 + view.gap + 9} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>corr ±1</text>
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Beta &amp; correlation of {base(symbol)} vs BTC over a trailing {window}-day window of daily returns
      </div>
    </div>
  );
}
