import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { frontier } from '@/lib/frontier';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const ANN = Math.sqrt(365);
const base = (sym: string) => sym.replace(/\/.*$/, '');
// Annualize daily figures for display: vol ×√365, return ×365.
const aVol = (v: number) => v * ANN;
const aRet = (r: number) => r * 365;

export function FrontierModule({ panel: _panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, '1d', '1y', signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const result = useMemo(() => (data ? frontier(data) : null), [data]);

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
    // Collect every point we'll draw (annualized) to fit the axes.
    const pts: { vol: number; ret: number }[] = [
      ...result.curve.map((p) => ({ vol: aVol(p.vol), ret: aRet(p.ret) })),
      ...result.assets.map((p) => ({ vol: aVol(p.vol), ret: aRet(p.ret) })),
    ];
    if (result.gmv) pts.push({ vol: aVol(result.gmv.vol), ret: aRet(result.gmv.ret) });
    if (result.tangency) pts.push({ vol: aVol(result.tangency.vol), ret: aRet(result.tangency.ret) });
    if (result.equal) pts.push({ vol: aVol(result.equal.vol), ret: aRet(result.equal.ret) });
    if (pts.length === 0) return null;

    let maxVol = 0;
    let minRet = Infinity;
    let maxRet = -Infinity;
    for (const p of pts) {
      maxVol = Math.max(maxVol, p.vol);
      minRet = Math.min(minRet, p.ret);
      maxRet = Math.max(maxRet, p.ret);
    }
    // Include the origin (for the capital market line) and pad.
    minRet = Math.min(minRet, 0);
    maxRet = Math.max(maxRet, 0);
    const retPad = (maxRet - minRet) * 0.08 || 0.01;
    minRet -= retPad;
    maxRet += retPad;
    maxVol = maxVol * 1.08 || 0.01;

    const padL = 30;
    const padB = 16;
    const padT = 6;
    const padR = 6;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 12 || ph <= 12) return null;

    const xAt = (vol: number) => padL + (vol / maxVol) * pw;
    const yAt = (ret: number) => padT + ((maxRet - ret) / (maxRet - minRet)) * ph;

    // Split the frontier into efficient (ret ≥ GMV) and inefficient branches.
    const gmvRet = result.gmv ? aRet(result.gmv.ret) : 0;
    const toXY = (p: { vol: number; ret: number }) => `${xAt(aVol(p.vol)).toFixed(1)},${yAt(aRet(p.ret)).toFixed(1)}`;
    const eff = result.curve.filter((p) => aRet(p.ret) >= gmvRet - 1e-9);
    const ineff = result.curve.filter((p) => aRet(p.ret) <= gmvRet + 1e-9);
    const effPath = eff.length > 1 ? eff.map(toXY).join(' ') : '';
    const ineffPath = ineff.length > 1 ? ineff.map(toXY).join(' ') : '';

    // Capital market line: from the risk-free origin through the tangency point,
    // extended to the right edge.
    let cml: { x1: number; y1: number; x2: number; y2: number } | null = null;
    if (result.tangency && result.tangency.vol > 0) {
      const slope = aRet(result.tangency.ret) / aVol(result.tangency.vol); // Sharpe
      cml = {
        x1: xAt(0),
        y1: yAt(0),
        x2: xAt(maxVol),
        y2: yAt(slope * maxVol),
      };
    }

    return { xAt, yAt, maxVol, minRet, maxRet, padL, padT, pw, ph, padB, effPath, ineffPath, cml };
  }, [result, size]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to plot the efficient frontier.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">efficient frontier · {result?.n ?? 0} assets · annualized · daily 1Y</span>
        <span className="ml-auto text-term-dim">
          {result?.tangency ? `max Sharpe ${(result.maxSharpe * ANN).toFixed(2)}` : ''}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {loading && !data ? (
            <Loading label="Loading history" />
          ) : error && !data ? (
            <ErrorMsg message={error} onRetry={refresh} />
          ) : !result || result.assets.length === 0 ? (
            <EmptyState>Not enough history to build a frontier.</EmptyState>
          ) : !result.ok ? (
            <EmptyState>
              Need ≥2 assets with distinct returns for a frontier (single asset or equal returns is degenerate).
            </EmptyState>
          ) : (
            view && (
              <svg width={size.w} height={size.h} className="block">
                {/* axes */}
                <line
                  x1={view.padL}
                  x2={view.padL + view.pw}
                  y1={view.yAt(0)}
                  y2={view.yAt(0)}
                  stroke="rgba(122,127,135,0.35)"
                  strokeWidth={1}
                />
                <line
                  x1={view.padL}
                  x2={view.padL}
                  y1={view.padT}
                  y2={view.padT + view.ph}
                  stroke="rgba(122,127,135,0.35)"
                  strokeWidth={1}
                />
                {/* capital market line */}
                {view.cml && (
                  <line
                    x1={view.cml.x1}
                    y1={view.cml.y1}
                    x2={view.cml.x2}
                    y2={view.cml.y2}
                    stroke="rgba(255,176,0,0.4)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                )}
                {/* inefficient branch (dim) */}
                {view.ineffPath && (
                  <polyline points={view.ineffPath} fill="none" stroke="rgba(122,127,135,0.5)" strokeWidth={1} strokeDasharray="2 2" />
                )}
                {/* efficient branch */}
                {view.effPath && (
                  <polyline points={view.effPath} fill="none" stroke="rgba(76,194,255,0.95)" strokeWidth={1.6} />
                )}
                {/* individual assets */}
                {result.assets.map((p) => (
                  <g key={p.symbol}>
                    <circle cx={view.xAt(aVol(p.vol))} cy={view.yAt(aRet(p.ret))} r={2} fill="rgba(122,127,135,0.8)" />
                    <text
                      x={view.xAt(aVol(p.vol)) + 3}
                      y={view.yAt(aRet(p.ret)) - 2}
                      className="text-term-muted"
                      fill="currentColor"
                      style={{ fontSize: 7 }}
                    >
                      {base(p.symbol)}
                    </text>
                  </g>
                ))}
                {/* equal-weight book */}
                {result.equal && (
                  <circle
                    cx={view.xAt(aVol(result.equal.vol))}
                    cy={view.yAt(aRet(result.equal.ret))}
                    r={2.4}
                    fill="none"
                    stroke="rgba(122,127,135,0.9)"
                    strokeWidth={1.2}
                  />
                )}
                {/* GMV (min variance) */}
                {result.gmv && (
                  <circle cx={view.xAt(aVol(result.gmv.vol))} cy={view.yAt(aRet(result.gmv.ret))} r={3} fill="#26c281" />
                )}
                {/* tangency (max Sharpe) */}
                {result.tangency && (
                  <circle
                    cx={view.xAt(aVol(result.tangency.vol))}
                    cy={view.yAt(aRet(result.tangency.ret))}
                    r={3}
                    fill="#ffb000"
                  />
                )}
                {/* axis labels */}
                <text x={2} y={view.padT + 7} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                  {(view.maxRet * 100).toFixed(0)}%
                </text>
                <text x={2} y={view.padT + view.ph} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                  {(view.minRet * 100).toFixed(0)}%
                </text>
                <text
                  x={view.padL + view.pw}
                  y={view.padT + view.ph + 11}
                  textAnchor="end"
                  className="text-term-dim"
                  fill="currentColor"
                  style={{ fontSize: 8 }}
                >
                  vol {(view.maxVol * 100).toFixed(0)}% →
                </text>
              </svg>
            )
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-term-border px-2 py-1 tabular-nums text-term-dim">
        {result?.gmv && (
          <span>
            <span className="text-term-up">●</span> GMV {(aRet(result.gmv.ret) * 100).toFixed(0)}% @ {(aVol(result.gmv.vol) * 100).toFixed(0)}%
          </span>
        )}
        {result?.tangency && (
          <span>
            <span className="text-term-amber">●</span> tangency {(aRet(result.tangency.ret) * 100).toFixed(0)}% @ {(aVol(result.tangency.vol) * 100).toFixed(0)}%
          </span>
        )}
        <span className="ml-auto">x = vol · y = return · OPT=GMV · MSR=tangency</span>
      </div>
    </div>
  );
}
