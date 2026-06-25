import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { toReturns } from '@/lib/correlation';
import { regress } from '@/lib/scatter';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];
const base = (sym: string) => sym.replace(/\/.*$/, '');

export function ScatterModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(1); // default 1Y
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

  const { pairs, reg } = useMemo(() => {
    if (!data) return { pairs: [] as Array<{ x: number; y: number }>, reg: null };
    const k = Math.min(data.a.length, data.b.length);
    const ay = toReturns(data.a.slice(-k));
    const bx = toReturns(data.b.slice(-k));
    const n = Math.min(ay.length, bx.length);
    const pairs = Array.from({ length: n }, (_, i) => ({ x: bx[i], y: ay[i] }));
    return { pairs, reg: regress(bx, ay) };
  }, [data]);

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
    if (pairs.length < 2 || size.w <= 0 || size.h <= 0) return null;
    let maxAbs = 0;
    for (const p of pairs) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
    maxAbs = (maxAbs || 0.01) * 1.08;
    const padL = 26;
    const padB = 14;
    const padT = 4;
    const padR = 4;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    const xAt = (v: number) => padL + ((v + maxAbs) / (2 * maxAbs)) * pw;
    const yAt = (v: number) => padT + ((maxAbs - v) / (2 * maxAbs)) * ph;
    const line = reg
      ? {
          x1: xAt(-maxAbs),
          y1: yAt(reg.intercept + reg.slope * -maxAbs),
          x2: xAt(maxAbs),
          y2: yAt(reg.intercept + reg.slope * maxAbs),
        }
      : null;
    return { maxAbs, xAt, yAt, x0: xAt(0), y0: yAt(0), line, padL, pw, padT, ph };
  }, [pairs, reg, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!reg) return <EmptyState>Not enough overlapping history for a scatter.</EmptyState>;

  const betaColor = reg.slope < 0 ? 'text-term-down' : Math.abs(reg.slope) >= 1 ? 'text-term-amber' : 'text-term-up';

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">{base(symbol)} returns vs BTC · daily</span>
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

      <div className="flex items-baseline gap-3 px-2 py-1 tabular-nums">
        <span className="text-term-muted">β <span className={`font-semibold ${betaColor}`}>{reg.slope.toFixed(2)}</span></span>
        <span className="text-term-muted">α <span className="text-term-text">{(reg.intercept * 100).toFixed(3)}%</span></span>
        <span className="text-term-muted">R² <span className="text-term-text">{(reg.r2 * 100).toFixed(0)}%</span></span>
        <span className="text-term-muted">ρ <span className="text-term-text">{reg.correlation.toFixed(2)}</span></span>
        <span className="ml-auto text-term-dim">{reg.n} days</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {/* zero axes */}
              <line x1={view.padL} x2={view.padL + view.pw} y1={view.y0} y2={view.y0} stroke="rgba(122,127,135,0.4)" strokeWidth={1} />
              <line x1={view.x0} x2={view.x0} y1={view.padT} y2={view.padT + view.ph} stroke="rgba(122,127,135,0.4)" strokeWidth={1} />
              {/* points */}
              {pairs.map((p, i) => (
                <circle key={i} cx={view.xAt(p.x)} cy={view.yAt(p.y)} r={1.4} fill="rgba(255,176,0,0.45)" />
              ))}
              {/* regression line */}
              {view.line && (
                <line x1={view.line.x1} y1={view.line.y1} x2={view.line.x2} y2={view.line.y2} stroke="rgba(76,194,255,0.95)" strokeWidth={1.5} />
              )}
              {/* axis labels */}
              <text x={2} y={view.padT + 8} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>+{(view.maxAbs * 100).toFixed(0)}%</text>
              <text x={2} y={view.padT + view.ph} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>−{(view.maxAbs * 100).toFixed(0)}%</text>
              <text x={view.padL + view.pw} y={view.y0 - 2} textAnchor="end" className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>BTC →</text>
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Each dot is a day (x = BTC return, y = {base(symbol)} return) · the line's slope is beta, its intercept alpha
      </div>
    </div>
  );
}
