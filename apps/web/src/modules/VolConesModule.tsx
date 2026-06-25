import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { toReturns } from '@/lib/correlation';
import { volCones } from '@/lib/volCones';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const HORIZONS = [10, 20, 30, 60, 90, 120];
const PERIODS_PER_YEAR = 365;

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];
const base = (sym: string) => sym.replace(/\/.*$/, '');
const pctVol = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Rich (high pctile) → red, cheap (low) → green, else amber. */
function rankColor(rank: number): string {
  if (rank >= 0.8) return '#ef4d56';
  if (rank <= 0.2) return '#26c281';
  return '#ffb000';
}
function rankLabel(rank: number): string {
  if (rank >= 0.8) return 'rich';
  if (rank <= 0.2) return 'cheap';
  return 'normal';
}

export function VolConesModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(1); // default 2Y
  const tf = TIMEFRAMES[tfIdx];

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const h = await api.history(symbol!, tf.interval, tf.range, signal);
      return { closes: h.candles.map((c) => c.close) };
    },
    [symbol, tf.interval, tf.range],
    { enabled: !!symbol },
  );

  const cones = useMemo(() => {
    if (!data || data.closes.length < 12) return null;
    const c = volCones(toReturns(data.closes), HORIZONS, PERIODS_PER_YEAR);
    return c.points.length ? c : null;
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
    if (!cones || size.w <= 0 || size.h <= 0) return null;
    const pts = cones.points;
    const padL = 30;
    const padR = 8;
    const padT = 8;
    const padB = 16;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    let yMax = 0;
    for (const p of pts) yMax = Math.max(yMax, p.max, p.current);
    yMax = (yMax || 0.01) * 1.08;
    const n = pts.length;
    const x = (i: number) => (n === 1 ? padL + pw / 2 : padL + (i / (n - 1)) * pw);
    const yAt = (v: number) => padT + (1 - v / yMax) * ph;

    const band = (hi: (p: typeof pts[number]) => number, lo: (p: typeof pts[number]) => number) => {
      const top = pts.map((p, i) => `${x(i).toFixed(1)},${yAt(hi(p)).toFixed(1)}`);
      const bottom = pts.map((p, i) => `${x(i).toFixed(1)},${yAt(lo(p)).toFixed(1)}`).reverse();
      return [...top, ...bottom].join(' ');
    };
    const line = (f: (p: typeof pts[number]) => number) =>
      pts.map((p, i) => `${x(i).toFixed(1)},${yAt(f(p)).toFixed(1)}`).join(' ');

    return {
      pts,
      padL,
      padT,
      pw,
      ph,
      padB,
      yMax,
      x,
      yAt,
      minMax: band((p) => p.max, (p) => p.min),
      iqr: band((p) => p.p75, (p) => p.p25),
      median: line((p) => p.p50),
      current: line((p) => p.current),
    };
  }, [cones, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!cones) return <EmptyState>Not enough history to build volatility cones.</EmptyState>;

  const head = cones.points.find((p) => p.horizon >= 30) ?? cones.points[cones.points.length - 1];

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">{base(symbol)} vol cones · annualized</span>
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
        <span className="text-term-muted">
          {head.horizon}d <span className="font-semibold text-term-text">{pctVol(head.current)}</span>
        </span>
        <span className="text-term-muted">
          pctile <span style={{ color: rankColor(head.rank) }}>{(head.rank * 100).toFixed(0)}%</span>
        </span>
        <span className="ml-auto font-semibold uppercase" style={{ color: rankColor(head.rank) }}>
          {rankLabel(head.rank)}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {/* y gridlines + labels at 0, ½, max */}
              {[0, 0.5, 1].map((f) => {
                const v = view.yMax * f;
                return (
                  <g key={f}>
                    <line
                      x1={view.padL}
                      x2={view.padL + view.pw}
                      y1={view.yAt(v)}
                      y2={view.yAt(v)}
                      stroke="rgba(122,127,135,0.18)"
                      strokeWidth={1}
                    />
                    <text x={2} y={view.yAt(v) + 3} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                      {(v * 100).toFixed(0)}%
                    </text>
                  </g>
                );
              })}
              {/* min–max envelope, then the inter-quartile band */}
              <polygon points={view.minMax} fill="rgba(122,127,135,0.14)" />
              <polygon points={view.iqr} fill="rgba(76,194,255,0.18)" />
              {/* median */}
              <polyline points={view.median} fill="none" stroke="rgba(160,166,176,0.8)" strokeWidth={1} strokeDasharray="3 2" />
              {/* current */}
              <polyline points={view.current} fill="none" stroke="rgba(255,176,0,0.95)" strokeWidth={1.5} />
              {view.pts.map((p, i) => (
                <circle key={p.horizon} cx={view.x(i)} cy={view.yAt(p.current)} r={2.4} fill={rankColor(p.rank)}>
                  <title>{`${p.horizon}d · now ${pctVol(p.current)} · ${(p.rank * 100).toFixed(0)}th pctile\nmedian ${pctVol(p.p50)} · range ${pctVol(p.min)}–${pctVol(p.max)}`}</title>
                </circle>
              ))}
              {/* x labels (horizon days) */}
              {view.pts.map((p, i) => (
                <text
                  key={p.horizon}
                  x={view.x(i)}
                  y={view.padT + view.ph + 11}
                  textAnchor="middle"
                  className="text-term-dim"
                  fill="currentColor"
                  style={{ fontSize: 8 }}
                >
                  {p.horizon}d
                </text>
              ))}
            </svg>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span>
          <span className="text-term-accent">band</span> 25–75% · median dashed ·{' '}
          <span className="text-term-amber">line</span> = now
        </span>
        <span className="ml-auto">{cones.points[0]?.samples ?? 0} windows</span>
      </div>
    </div>
  );
}
