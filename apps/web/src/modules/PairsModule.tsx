import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePanels } from '@/store/usePanels';
import { combineSeries } from '@/lib/ratio';
import { pairStats } from '@/lib/pairs';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const PRESETS: { label: string; interval: Interval; range: Range }[] = [
  { label: '1M', interval: '1d', range: '1mo' },
  { label: '3M', interval: '1d', range: '3mo' },
  { label: '6M', interval: '1d', range: '6mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];
const WINDOWS = [20, 50, 100];

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 2 : a >= 1 ? 4 : 6);
}

export function PairsModule({ panel }: ModuleProps) {
  const setPanelParams = usePanels((s) => s.setPanelParams);
  const interval = (panel.params?.interval as Interval) ?? '1d';
  const range = (panel.params?.range as Range) ?? '6mo';

  const [num, setNum] = useState(() =>
    ((panel.params?.num as string) ?? panel.symbol ?? 'ETH/USDT').toUpperCase(),
  );
  const [den, setDen] = useState(() => ((panel.params?.den as string) ?? 'BTC/USDT').toUpperCase());
  const [window, setWindow] = useState<number>(() => Number(panel.params?.window) || 20);
  const [numInput, setNumInput] = useState(num);
  const [denInput, setDenInput] = useState(den);

  useEffect(() => {
    setPanelParams(panel.id, { num, den, window });
  }, [num, den, window, panel.id, setPanelParams]);

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const [a, b] = await Promise.all([
        api.history(num, interval, range, signal),
        api.history(den, interval, range, signal),
      ]);
      return { a: a.candles, b: b.candles };
    },
    [num, den, interval, range],
    { enabled: Boolean(num && den) },
  );

  const points = useMemo(() => (data ? combineSeries(data.a, data.b, 'ratio') : []), [data]);
  const ps = useMemo(() => (points.length ? pairStats(points.map((p) => p.value), window) : null), [points, window]);

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
    if (!ps || points.length < 2 || size.w <= 0 || size.h <= 0) return null;
    const st = ps.stats;
    const n = points.length;
    const padL = 6;
    const padR = 44;
    const padT = 6;
    const gap = 12;
    const pw = size.w - padL - padR;
    const h1 = Math.floor((size.h - gap - 6) * 0.66);
    const h2 = size.h - gap - 6 - h1;
    if (pw <= 10 || h1 <= 10 || h2 <= 10) return null;

    const xAt = (i: number) => padL + (n === 1 ? 0 : (i / (n - 1)) * pw);

    // Top pane range covers the ±2σ band envelope and the ratio line.
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      vals.push(points[i].value);
      if (Number.isFinite(st[i].mean)) vals.push(st[i].mean + 2 * st[i].std, st[i].mean - 2 * st[i].std);
    }
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pv = (hi - lo) * 0.06;
    lo -= pv;
    hi += pv;
    const yTop = (v: number) => padT + ((hi - v) / (hi - lo)) * h1;

    const ratioLine = points.map((p, i) => `${xAt(i).toFixed(1)},${yTop(p.value).toFixed(1)}`).join(' ');
    const def: number[] = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(st[i].mean)) def.push(i);
    const bandPath = (k: number) => {
      if (def.length < 2) return '';
      const up = def.map((i) => `${xAt(i).toFixed(1)},${yTop(st[i].mean + k * st[i].std).toFixed(1)}`);
      const dn = def
        .slice()
        .reverse()
        .map((i) => `${xAt(i).toFixed(1)},${yTop(st[i].mean - k * st[i].std).toFixed(1)}`);
      return `M ${[...up, ...dn].join(' L ')} Z`;
    };
    const meanLine = def.map((i) => `${xAt(i).toFixed(1)},${yTop(st[i].mean).toFixed(1)}`).join(' ');

    // Bottom pane: z oscillator, symmetric range.
    const zTop = padT + h1 + gap;
    let zMax = 2.5;
    for (const s of st) if (Number.isFinite(s.z)) zMax = Math.max(zMax, Math.abs(s.z));
    zMax *= 1.1;
    const yZ = (z: number) => zTop + ((zMax - z) / (2 * zMax)) * h2;
    const zLine = def.map((i) => `${xAt(i).toFixed(1)},${yZ(st[i].z).toFixed(1)}`).join(' ');
    const zRefs = [2, 1, 0, -1, -2].map((z) => ({ z, y: yZ(z) }));

    const lastZ = st[n - 1].z;
    return {
      padL,
      padR,
      pw,
      hi,
      lo,
      yTop,
      zTop,
      h2,
      yZ,
      ratioLine,
      meanLine,
      band1: bandPath(1),
      band2: bandPath(2),
      zLine,
      zRefs,
      lastX: xAt(n - 1),
      lastRatioY: yTop(points[n - 1].value),
      lastZY: Number.isFinite(lastZ) ? yZ(lastZ) : null,
      W: size.w,
      H: size.h,
    };
  }, [ps, points, size]);

  const commit = () => {
    const n = numInput.trim().toUpperCase();
    const d = denInput.trim().toUpperCase();
    if (n) setNum(n);
    if (d) setDen(d);
  };
  const swap = () => {
    setNum(den);
    setDen(num);
    setNumInput(den);
    setDenInput(num);
  };
  const inputCls =
    'w-24 rounded-sm border border-term-border bg-transparent px-1.5 py-0.5 text-xs uppercase text-term-text outline-none focus:border-term-amber';

  const z = ps?.z ?? NaN;
  const zColor =
    Math.abs(z) >= 2 ? (z > 0 ? 'text-term-down' : 'text-term-up') : 'text-term-text';
  const sig = ps?.signal ?? 'neutral';
  const sigStyle =
    sig === 'rich'
      ? 'border-term-down text-term-down'
      : sig === 'cheap'
        ? 'border-term-up text-term-up'
        : 'border-term-border text-term-muted';
  const sigHint = sig === 'rich' ? `short ${num} / long ${den}` : sig === 'cheap' ? `long ${num} / short ${den}` : '';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-term-amber">
            {num} ÷ {den}
          </span>
          {ps && (
            <>
              <span className="text-xs tabular-nums text-term-text">{fmtNum(ps.ratio)}</span>
              <span className={`text-2xs tabular-nums ${zColor}`}>z {Number.isFinite(z) ? z.toFixed(2) : '—'}</span>
            </>
          )}
        </div>
        <div className="no-drag flex gap-0.5">
          {PRESETS.map((p) => {
            const active = p.interval === interval && p.range === range;
            return (
              <button
                key={p.label}
                onClick={() => setPanelParams(panel.id, { interval: p.interval, range: p.range })}
                className={`rounded-sm border px-1.5 py-0.5 text-2xs ${
                  active ? 'border-term-amber text-term-amber' : 'border-transparent text-term-muted hover:text-term-text'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="no-drag flex items-center gap-1 border-b border-term-border px-2 py-1 text-2xs">
        <input
          value={numInput}
          onChange={(e) => setNumInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          onBlur={commit}
          placeholder="ETH/USDT"
          className={inputCls}
        />
        <button onClick={swap} title="Swap" className="px-1 text-term-muted hover:text-term-amber">
          ⇄
        </button>
        <input
          value={denInput}
          onChange={(e) => setDenInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          onBlur={commit}
          placeholder="BTC/USDT"
          className={inputCls}
        />
        <div className="ml-auto flex items-center gap-1">
          {ps && (
            <span className={`rounded-sm border px-1.5 py-0.5 uppercase ${sigStyle}`} title={sigHint}>
              {sig}
            </span>
          )}
          <span className="text-term-dim">
            HL {ps?.halfLife != null ? `${ps.halfLife.toFixed(1)}` : '—'}
          </span>
          <span className="flex gap-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`rounded-sm px-1 py-0.5 ${
                  window === w ? 'text-term-amber' : 'text-term-muted hover:text-term-text'
                }`}
              >
                {w}
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label="Loading pair" />
          </div>
        )}
        {error && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} onRetry={refresh} />
          </div>
        )}
        {data && points.length < 2 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState>No overlapping history for {num} and {den}.</EmptyState>
          </div>
        )}

        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={view.W} height={view.H} className="block">
              {/* ±σ bands */}
              {view.band2 && <path d={view.band2} fill="rgba(255,176,0,0.06)" />}
              {view.band1 && <path d={view.band1} fill="rgba(255,176,0,0.1)" />}
              {view.meanLine && (
                <polyline points={view.meanLine} fill="none" stroke="rgba(122,127,135,0.7)" strokeWidth={1} strokeDasharray="4 3" />
              )}
              <polyline points={view.ratioLine} fill="none" stroke="rgba(255,176,0,0.95)" strokeWidth={1.25} />
              <circle cx={view.lastX} cy={view.lastRatioY} r={2.5} fill="#ffb000" />
              <text x={view.W - view.padR + 4} y={view.yTop(view.hi) + 8} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {fmtNum(view.hi)}
              </text>
              <text x={view.W - view.padR + 4} y={view.yTop(view.lo) - 2} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {fmtNum(view.lo)}
              </text>

              {/* z oscillator */}
              {view.zRefs.map((r) => (
                <g key={r.z}>
                  <line
                    x1={view.padL}
                    x2={view.padL + view.pw}
                    y1={r.y}
                    y2={r.y}
                    stroke={r.z === 0 ? 'rgba(122,127,135,0.5)' : Math.abs(r.z) === 2 ? 'rgba(239,77,86,0.4)' : 'rgba(122,127,135,0.22)'}
                    strokeWidth={1}
                    strokeDasharray={r.z === 0 ? undefined : '3 3'}
                  />
                  <text x={view.W - view.padR + 4} y={r.y + 3} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                    {r.z > 0 ? `+${r.z}` : r.z}
                  </text>
                </g>
              ))}
              {view.zLine && <polyline points={view.zLine} fill="none" stroke="rgba(76,194,255,0.9)" strokeWidth={1.25} />}
              {view.lastZY != null && <circle cx={view.lastX} cy={view.lastZY} r={2.5} fill="#4cc2ff" />}
              <text x={view.padL + 2} y={view.zTop + 9} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                z-score
              </text>
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
