import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { toReturns } from '@/lib/correlation';
import { avgCorrelation } from '@/lib/avgCorrelation';
import { fmtDate } from '@/lib/format';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 16;
const WINDOWS = [30, 60, 90];
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);

/** Regime read-out from the current average correlation. */
function regime(c: number): { label: string; color: string } {
  if (c >= 0.7) return { label: 'risk-off', color: '#ef4d56' };
  if (c <= 0.3) return { label: 'dispersed', color: '#26c281' };
  return { label: 'mixed', color: '#ffb000' };
}

export function AvgCorrModule(_props: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [window, setWindow] = useState(30);

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, '1d', '2y', signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close), times: h.candles.map((c) => c.time) }))
            .catch(() => ({ symbol: s, closes: [] as number[], times: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length >= 2 },
  );

  const result = useMemo(() => {
    if (!data) return null;
    const valid = data.filter((d) => d.closes.length >= 3);
    if (valid.length < 2) return null;
    const rets = valid.map((d) => toReturns(d.closes));
    const K = Math.min(...rets.map((r) => r.length));
    if (K < window) return null;
    const aligned = rets.map((r) => r.slice(-K));
    const ref = valid[0];
    const refTimes = ref.times.slice(-K);
    const ac = avgCorrelation(aligned, refTimes, window);
    return ac.points.length ? { ac, symbols: valid.length } : null;
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
    if (!result || size.w <= 0 || size.h <= 0) return null;
    const pts = result.ac.points;
    const padL = 26;
    const padR = 6;
    const padT = 6;
    const padB = 14;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    const t0 = pts[0].time;
    const t1 = pts[pts.length - 1].time;
    const span = t1 - t0 || 1;
    const yMin = Math.min(0, result.ac.min!);
    const yMax = Math.max(0.1, result.ac.max!);
    const yspan = yMax - yMin || 1;
    const x = (t: number) => padL + ((t - t0) / span) * pw;
    const yAt = (v: number) => padT + (1 - (v - yMin) / yspan) * ph;
    const line = pts.map((p) => `${x(p.time).toFixed(1)},${yAt(p.avg).toFixed(1)}`).join(' ');
    return { pts, padL, padT, pw, ph, yMin, yMax, x, yAt, line, last: pts[pts.length - 1], t0, t1 };
  }, [result, size]);

  if (watchlist.length < 2) {
    return <EmptyState>Add at least two watchlist symbols (W) to track average correlation.</EmptyState>;
  }
  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!result) return <EmptyState>Not enough overlapping history for a {window}-day window.</EmptyState>;

  const reg = regime(result.ac.current!);

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">avg pairwise corr · {result.symbols} names · daily</span>
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
          now <span className="font-semibold" style={{ color: reg.color }}>{result.ac.current!.toFixed(2)}</span>
        </span>
        <span className="text-term-muted">avg <span className="text-term-text">{result.ac.mean!.toFixed(2)}</span></span>
        <span className="ml-auto font-semibold uppercase" style={{ color: reg.color }}>
          {reg.label}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {view.yMin < 0 && (
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
              <text x={2} y={view.padT + 7} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {view.yMax.toFixed(2)}
              </text>
              <text x={2} y={view.padT + view.ph} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {view.yMin.toFixed(2)}
              </text>
              <polyline points={view.line} fill="none" stroke="rgba(76,194,255,0.95)" strokeWidth={1.5} />
              <circle cx={view.x(view.last.time)} cy={view.yAt(view.last.avg)} r={2.6} fill={reg.color} />
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
        Mean of all pairwise return correlations · high = everything moves together (risk-off), low = dispersion
      </div>
    </div>
  );
}
