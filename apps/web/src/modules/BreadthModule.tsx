import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { breadth } from '@/lib/breadth';
import { fmtDate } from '@/lib/format';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const WINDOWS = [20, 50, 100];
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);

/** Regime read-out from the current breadth percent. */
function regime(p: number): { label: string; color: string } {
  if (p >= 70) return { label: 'broad strength', color: '#26c281' };
  if (p <= 30) return { label: 'broad weakness', color: '#ef4d56' };
  return { label: 'mixed', color: '#ffb000' };
}

export function BreadthModule(_props: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [window, setWindow] = useState(50);

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
    const valid = data.filter((d) => d.closes.length >= window);
    if (valid.length < 2) return null;
    let ref = valid[0];
    for (const d of valid) if (d.times.length > ref.times.length) ref = d;
    const b = breadth(valid.map((d) => d.closes), ref.times, window);
    return b.points.length ? { b, symbols: valid.length } : null;
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
    const pts = result.b.points;
    const padL = 22;
    const padR = 6;
    const padT = 6;
    const padB = 14;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    const t0 = pts[0].time;
    const t1 = pts[pts.length - 1].time;
    const span = t1 - t0 || 1;
    const x = (t: number) => padL + ((t - t0) / span) * pw;
    const yAt = (v: number) => padT + (1 - v / 100) * ph;
    const line = pts.map((p) => `${x(p.time).toFixed(1)},${yAt(p.pct).toFixed(1)}`).join(' ');
    return { pts, padL, padT, pw, ph, x, yAt, line, last: pts[pts.length - 1], t0, t1 };
  }, [result, size]);

  if (watchlist.length < 2) {
    return <EmptyState>Add at least two watchlist symbols (W) to measure market breadth.</EmptyState>;
  }
  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!result) return <EmptyState>Not enough overlapping history for a {window}-day window.</EmptyState>;

  const reg = regime(result.b.current!);

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">% above MA · {result.symbols} names · daily</span>
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
          now <span className="font-semibold" style={{ color: reg.color }}>{result.b.current!.toFixed(0)}%</span>
        </span>
        <span className="text-term-muted">avg <span className="text-term-text">{result.b.mean!.toFixed(0)}%</span></span>
        <span className="ml-auto font-semibold uppercase" style={{ color: reg.color }}>
          {reg.label}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {/* 30 / 50 / 70 reference lines */}
              {[30, 50, 70].map((lvl) => (
                <line
                  key={lvl}
                  x1={view.padL}
                  x2={view.padL + view.pw}
                  y1={view.yAt(lvl)}
                  y2={view.yAt(lvl)}
                  stroke="rgba(122,127,135,0.18)"
                  strokeWidth={1}
                  strokeDasharray={lvl === 50 ? undefined : '2 3'}
                />
              ))}
              {[0, 50, 100].map((lvl) => (
                <text key={lvl} x={2} y={view.yAt(lvl) + 3} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                  {lvl}
                </text>
              ))}
              <polyline points={view.line} fill="none" stroke="rgba(76,194,255,0.95)" strokeWidth={1.5} />
              <circle cx={view.x(view.last.time)} cy={view.yAt(view.last.pct)} r={2.6} fill={reg.color} />
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
        Share of names above their {window}-day MA · high = broad participation, falling while price holds = warning
      </div>
    </div>
  );
}
