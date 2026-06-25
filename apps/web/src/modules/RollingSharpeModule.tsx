import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { rollingSharpe } from '@/lib/rollingSharpe';
import { fmtDate } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const WINDOWS = [30, 60, 90];
const PERIODS_PER_YEAR = 365;
const base = (sym: string) => sym.replace(/\/.*$/, '');
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);
const fmtSharpe = (v: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2));
const sharpeColor = (v: number | null) =>
  v == null ? 'text-term-muted' : v >= 0 ? 'text-term-up' : 'text-term-down';

export function RollingSharpeModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [window, setWindow] = useState(30);

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const h = await api.history(symbol!, '1d', '2y', signal);
      return { closes: h.candles.map((c) => c.close), times: h.candles.map((c) => c.time) };
    },
    [symbol],
    { enabled: !!symbol },
  );

  const rs = useMemo(() => {
    if (!data) return null;
    const r = rollingSharpe(data.closes, data.times, window, PERIODS_PER_YEAR);
    return r.points.length ? r : null;
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
    if (!rs || size.w <= 0 || size.h <= 0) return null;
    const pts = rs.points;
    const padL = 28;
    const padR = 6;
    const padT = 6;
    const padB = 14;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    const t0 = pts[0].time;
    const t1 = pts[pts.length - 1].time;
    const span = t1 - t0 || 1;
    const yMin = Math.min(0, rs.min!);
    const yMax = Math.max(0, rs.max!);
    const yspan = yMax - yMin || 1;
    const x = (t: number) => padL + ((t - t0) / span) * pw;
    const yAt = (s: number) => padT + (1 - (s - yMin) / yspan) * ph;
    const line = pts.map((p) => `${x(p.time).toFixed(1)},${yAt(p.sharpe).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return { pts, padL, padR, padT, padB, pw, ph, yMin, yMax, x, yAt, line, last, t0, t1 };
  }, [rs, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!rs) return <EmptyState>Not enough history for a {window}-day rolling Sharpe.</EmptyState>;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">{base(symbol)} rolling Sharpe · daily</span>
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                w === window ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3 px-2 py-1 tabular-nums">
        <span className="text-term-muted">
          now <span className={`font-semibold ${sharpeColor(rs.current)}`}>{fmtSharpe(rs.current)}</span>
        </span>
        <span className="text-term-muted">avg <span className="text-term-text">{fmtSharpe(rs.avg)}</span></span>
        <span className="ml-auto text-term-dim">
          range {fmtSharpe(rs.min)} … {fmtSharpe(rs.max)}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {/* zero baseline */}
              {view.yMin < 0 && view.yMax > 0 && (
                <line
                  x1={view.padL}
                  x2={view.padL + view.pw}
                  y1={view.yAt(0)}
                  y2={view.yAt(0)}
                  stroke="rgba(122,127,135,0.4)"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
              )}
              {/* y labels */}
              <text x={2} y={view.padT + 7} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {view.yMax.toFixed(1)}
              </text>
              <text x={2} y={view.padT + view.ph} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {view.yMin.toFixed(1)}
              </text>
              {/* rolling line */}
              <polyline points={view.line} fill="none" stroke="rgba(255,176,0,0.95)" strokeWidth={1.5} />
              {/* current point */}
              <circle
                cx={view.x(view.last.time)}
                cy={view.yAt(view.last.sharpe)}
                r={2.6}
                fill={view.last.sharpe >= 0 ? 'rgb(38,194,129)' : 'rgb(239,77,86)'}
              />
              {/* date axis */}
              <text x={view.padL} y={view.padT + view.ph + 11} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {fmtDate(toMs(view.t0))}
              </text>
              <text
                x={view.padL + view.pw}
                y={view.padT + view.ph + 11}
                textAnchor="end"
                className="text-term-dim"
                fill="currentColor"
                style={{ fontSize: 8 }}
              >
                {fmtDate(toMs(view.t1))}
              </text>
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Trailing {window}-day annualized Sharpe (mean ÷ σ × √365) · rising = improving risk-adjusted return
      </div>
    </div>
  );
}
