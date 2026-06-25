import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { projectCone } from '@/lib/montecarlo';
import { fmtPrice } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const HORIZONS = [30, 60, 90, 180];
const PATHS = 12;
const ANNUAL = Math.sqrt(365);

function randNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function MonteCarloModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [horizon, setHorizon] = useState(60);

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.history(symbol!, '1d', '1y', signal),
    [symbol],
    { enabled: !!symbol },
  );

  const proj = useMemo(
    () => (data ? projectCone(data.candles.map((c) => c.close), horizon) : null),
    [data, horizon],
  );

  // Illustrative random GBM paths — regenerated only when the projection changes.
  const paths = useMemo(() => {
    if (!proj) return [];
    const { s0, driftDaily: m, volDaily: s } = proj;
    return Array.from({ length: PATHS }, () => {
      const out = [s0];
      for (let d = 1; d <= proj.horizon; d++) out.push(out[d - 1] * Math.exp(m + s * randNormal()));
      return out;
    });
  }, [proj]);

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
    if (!proj || size.w <= 0 || size.h <= 0) return null;
    const pts = proj.points;
    let lo = Math.min(proj.s0, ...pts.map((p) => p.p5));
    let hi = Math.max(proj.s0, ...pts.map((p) => p.p95));
    if (lo === hi) hi = lo + 1;
    const pad = (hi - lo) * 0.05;
    lo -= pad;
    hi += pad;
    const padR = 44;
    const padY = 6;
    const pw = size.w - padR;
    const ph = size.h - padY * 2;
    const xAt = (d: number) => (d / proj.horizon) * pw;
    const yAt = (v: number) => padY + ((hi - v) / (hi - lo)) * ph;

    const band = (loKey: 'p5' | 'p25', hiKey: 'p95' | 'p75') => {
      const up = pts.map((p) => `${xAt(p.day).toFixed(1)},${yAt(p[hiKey]).toFixed(1)}`);
      const dn = pts
        .slice()
        .reverse()
        .map((p) => `${xAt(p.day).toFixed(1)},${yAt(p[loKey]).toFixed(1)}`);
      return `M ${[...up, ...dn].join(' L ')} Z`;
    };
    const median = pts.map((p) => `${xAt(p.day).toFixed(1)},${yAt(p.p50).toFixed(1)}`).join(' ');
    const pathLines = paths.map((pr) =>
      pr.map((v, d) => `${xAt(d).toFixed(1)},${yAt(v).toFixed(1)}`).join(' '),
    );
    return { lo, hi, pw, padR, xAt, yAt, band90: band('p5', 'p95'), band50: band('p25', 'p75'), median, pathLines, s0Y: yAt(proj.s0) };
  }, [proj, paths, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!proj) return <EmptyState>Not enough history to project.</EmptyState>;

  const end = proj.points[proj.points.length - 1];
  const chg = (v: number) => `${v >= proj.s0 ? '+' : '−'}${(Math.abs(v / proj.s0 - 1) * 100).toFixed(0)}%`;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">
          GBM cone · σ {(proj.volDaily * ANNUAL * 100).toFixed(0)}%/yr · drift {(proj.driftDaily * 365 * 100).toFixed(0)}%/yr
        </span>
        <div className="ml-auto flex gap-1">
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                horizon === h ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {h}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3 px-2 py-1 tabular-nums">
        <span className="text-term-muted">spot <span className="text-term-text">{fmtPrice(proj.s0)}</span></span>
        <span className="ml-auto text-term-dim">
          {horizon}d: <span className="text-term-down">{fmtPrice(end.p5)} ({chg(end.p5)})</span> ·{' '}
          <span className="text-term-text">{fmtPrice(end.p50)} ({chg(end.p50)})</span> ·{' '}
          <span className="text-term-up">{fmtPrice(end.p95)} ({chg(end.p95)})</span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              <path d={view.band90} fill="rgba(255,176,0,0.07)" />
              <path d={view.band50} fill="rgba(255,176,0,0.12)" />
              {view.pathLines.map((d, i) => (
                <polyline key={i} points={d} fill="none" stroke="rgba(207,210,214,0.15)" strokeWidth={0.75} />
              ))}
              <line x1={0} x2={view.pw} y1={view.s0Y} y2={view.s0Y} stroke="rgba(122,127,135,0.4)" strokeWidth={1} strokeDasharray="3 3" />
              <polyline points={view.median} fill="none" stroke="rgba(255,176,0,0.95)" strokeWidth={1.5} />
              {/* right-edge percentile labels */}
              <text x={view.pw + 3} y={view.yAt(end.p95) + 3} fill="rgba(38,194,129,0.8)" style={{ fontSize: 8 }}>95</text>
              <text x={view.pw + 3} y={view.yAt(end.p50) + 3} fill="rgba(255,176,0,0.85)" style={{ fontSize: 8 }}>50</text>
              <text x={view.pw + 3} y={view.yAt(end.p5) + 3} fill="rgba(239,77,86,0.8)" style={{ fontSize: 8 }}>5</text>
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Lognormal price cone from {symbol}'s daily drift/vol · bands are 5–95 / 25–75 percentiles · illustrative, not advice
      </div>
    </div>
  );
}
