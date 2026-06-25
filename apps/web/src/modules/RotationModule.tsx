import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { rrgFor, type Quadrant, type RrgResult } from '@/lib/rrg';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const MAX = 16;
const WINDOW = 10;
const TAIL = 8;

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

const QUAD: Record<Quadrant, { rgb: string; label: string }> = {
  leading: { rgb: '38,194,129', label: 'LEADING' },
  weakening: { rgb: '255,176,0', label: 'WEAKENING' },
  lagging: { rgb: '239,77,86', label: 'LAGGING' },
  improving: { rgb: '76,194,255', label: 'IMPROVING' },
};

const base = (sym: string) => sym.replace(/\/.*$/, '');

export function RotationModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const tf = TIMEFRAMES[tfIdx];

  const fetchSyms = useMemo(
    () => Array.from(new Set([BENCH, ...watchlist.slice(0, MAX)])),
    [watchlist],
  );

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

  const bench = useMemo(() => data?.find((d) => d.symbol === BENCH), [data]);
  const points = useMemo(() => {
    if (!bench || bench.closes.length < WINDOW + 2) return [] as RrgResult[];
    const out: RrgResult[] = [];
    for (const d of data ?? []) {
      if (d.symbol === BENCH) continue;
      const r = rrgFor(d.symbol, d.closes, bench.closes, WINDOW, TAIL);
      if (r) out.push(r);
    }
    return out;
  }, [data, bench]);

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

  const geom = useMemo(() => {
    const { w: W, h: H } = size;
    if (W <= 0 || H <= 0 || points.length === 0) return null;
    const padL = 30;
    const padR = 12;
    const padT = 14;
    const padB = 20;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    let maxDev = 1.5;
    for (const p of points) for (const t of p.tail) {
      maxDev = Math.max(maxDev, Math.abs(t.ratio - 100), Math.abs(t.mom - 100));
    }
    maxDev *= 1.15;
    const lo = 100 - maxDev;
    const hi = 100 + maxDev;
    const span = hi - lo;
    const xFor = (r: number) => padL + ((r - lo) / span) * pw;
    const yFor = (m: number) => padT + ((hi - m) / span) * ph;
    return { padL, padR, padT, padB, pw, ph, xFor, yFor, cx: xFor(100), cy: yFor(100) };
  }, [points, size]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to see rotation vs BTC.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">rotation vs {base(BENCH)} · RS-Ratio × RS-Momentum</span>
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

      <div className="relative min-h-0 flex-1">
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label="Loading history" />
          </div>
        )}
        {error && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} onRetry={refresh} />
          </div>
        )}
        {data && !loading && points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState>
              {bench && bench.closes.length >= WINDOW + 2
                ? 'Add non-BTC watchlist symbols to plot.'
                : 'Not enough BTC history to benchmark.'}
            </EmptyState>
          </div>
        )}

        <div ref={wrapRef} className="absolute inset-0">
          {geom && (
            <svg width={size.w} height={size.h} className="block">
              {/* Quadrant backgrounds */}
              <rect x={geom.cx} y={geom.padT} width={geom.padL + geom.pw - geom.cx} height={geom.cy - geom.padT} fill={`rgba(${QUAD.leading.rgb},0.06)`} />
              <rect x={geom.padL} y={geom.padT} width={geom.cx - geom.padL} height={geom.cy - geom.padT} fill={`rgba(${QUAD.improving.rgb},0.06)`} />
              <rect x={geom.cx} y={geom.cy} width={geom.padL + geom.pw - geom.cx} height={geom.padT + geom.ph - geom.cy} fill={`rgba(${QUAD.weakening.rgb},0.06)`} />
              <rect x={geom.padL} y={geom.cy} width={geom.cx - geom.padL} height={geom.padT + geom.ph - geom.cy} fill={`rgba(${QUAD.lagging.rgb},0.06)`} />

              {/* Centre cross at (100, 100) */}
              <line x1={geom.cx} x2={geom.cx} y1={geom.padT} y2={geom.padT + geom.ph} stroke="rgba(122,127,135,0.45)" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={geom.padL} x2={geom.padL + geom.pw} y1={geom.cy} y2={geom.cy} stroke="rgba(122,127,135,0.45)" strokeWidth={1} strokeDasharray="3 3" />

              {/* Quadrant captions */}
              <text x={geom.padL + geom.pw - 3} y={geom.padT + 9} textAnchor="end" fill={`rgba(${QUAD.leading.rgb},0.7)`} style={{ fontSize: 8 }}>{QUAD.leading.label}</text>
              <text x={geom.padL + 3} y={geom.padT + 9} fill={`rgba(${QUAD.improving.rgb},0.7)`} style={{ fontSize: 8 }}>{QUAD.improving.label}</text>
              <text x={geom.padL + geom.pw - 3} y={geom.padT + geom.ph - 3} textAnchor="end" fill={`rgba(${QUAD.weakening.rgb},0.7)`} style={{ fontSize: 8 }}>{QUAD.weakening.label}</text>
              <text x={geom.padL + 3} y={geom.padT + geom.ph - 3} fill={`rgba(${QUAD.lagging.rgb},0.7)`} style={{ fontSize: 8 }}>{QUAD.lagging.label}</text>

              {/* Axis captions */}
              <text x={geom.padL + geom.pw / 2} y={size.h - 6} textAnchor="middle" className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>RS-Ratio →</text>
              <text x={10} y={geom.padT + geom.ph / 2} textAnchor="middle" transform={`rotate(-90 10 ${geom.padT + geom.ph / 2})`} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>RS-Momentum →</text>

              {/* Symbols: tail + dot + label */}
              {points.map((p) => {
                const c = QUAD[p.quadrant].rgb;
                const tailPts = p.tail.map((t) => `${geom.xFor(t.ratio).toFixed(1)},${geom.yFor(t.mom).toFixed(1)}`).join(' ');
                const x = geom.xFor(p.ratio);
                const y = geom.yFor(p.mom);
                return (
                  <g key={p.symbol} className="no-drag cursor-pointer" onClick={() => navigate(panel, p.symbol)}>
                    {p.tail.length > 1 && <polyline points={tailPts} fill="none" stroke={`rgba(${c},0.45)`} strokeWidth={1} />}
                    <circle cx={x} cy={y} r={3} fill={`rgb(${c})`} />
                    <text x={x + 5} y={y + 3} fill={`rgb(${c})`} style={{ fontSize: 9 }}>{base(p.symbol)}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
