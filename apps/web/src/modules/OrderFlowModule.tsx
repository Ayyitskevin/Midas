import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Trade } from '@midas/shared';
import { useStream, useStreamStatus } from '@/lib/stream';
import { fmtCompact } from '@/lib/format';
import { bucketFlow, flowSummary, type FlowBucket } from '@/lib/orderflow';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BUFFER_CAP = 500; // trades retained
const BUCKET_MS = 2000; // delta histogram window
const TARGET_BAR_W = 6; // px per bucket

function fmtSignedCompact(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtCompact(Math.abs(v))}`;
}

export function OrderFlowModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [trades, setTrades] = useState<Trade[]>([]);
  const status = useStreamStatus();

  useEffect(() => setTrades([]), [symbol]);
  const onTrade = useCallback((d: unknown) => {
    setTrades((prev) => {
      const next = [...prev, d as Trade];
      return next.length > BUFFER_CAP ? next.slice(next.length - BUFFER_CAP) : next;
    });
  }, []);
  useStream('trades', symbol, onTrade);

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

  const buckets = useMemo(() => bucketFlow(trades, BUCKET_MS), [trades]);
  const summary = useMemo(() => flowSummary(trades), [trades]);

  const visibleBars = Math.max(8, Math.min(buckets.length, Math.floor(size.w / TARGET_BAR_W) || 8));
  const shown = useMemo(
    () => (buckets.length > visibleBars ? buckets.slice(buckets.length - visibleBars) : buckets),
    [buckets, visibleBars],
  );

  // Geometry: CVD line pane on top, delta histogram below, shared x-axis.
  const geom = useMemo(() => {
    const W = size.w;
    const H = size.h;
    if (W <= 0 || H <= 0 || shown.length === 0) return null;
    const gap = 14;
    const h1 = Math.max(8, Math.floor((H - gap) * 0.62));
    const h2 = Math.max(8, H - gap - h1);
    const deltaTop = h1 + gap;
    const deltaMid = deltaTop + h2 / 2;
    const barW = W / shown.length;

    const cvds = shown.map((b) => b.cvd);
    let minC = Math.min(0, ...cvds);
    let maxC = Math.max(0, ...cvds);
    if (minC === maxC) maxC = minC + 1;
    const yCvd = (v: number) => h1 - ((v - minC) / (maxC - minC)) * h1;

    const maxAbs = Math.max(1e-9, ...shown.map((b) => Math.abs(b.delta)));

    return { W, H, h1, h2, deltaTop, deltaMid, barW, minC, maxC, yCvd, maxAbs, zeroY: yCvd(0) };
  }, [shown, size]);

  const plot = useMemo(() => {
    if (!geom) return null;
    const { barW, deltaMid, h2, maxAbs, yCvd } = geom;
    const linePts = shown
      .map((b, i) => `${(i * barW + barW / 2).toFixed(1)},${yCvd(b.cvd).toFixed(1)}`)
      .join(' ');
    const bars = shown.map((b, i) => {
      const h = (Math.abs(b.delta) / maxAbs) * (h2 / 2 - 1);
      const up = b.delta >= 0;
      return (
        <rect
          key={i}
          x={i * barW + barW * 0.12}
          y={up ? deltaMid - h : deltaMid}
          width={Math.max(0.6, barW * 0.76)}
          height={Math.max(0, h)}
          fill={up ? 'rgba(38,194,129,0.75)' : 'rgba(239,77,86,0.75)'}
        />
      );
    });
    return { linePts, bars };
  }, [geom, shown]);

  // Crosshair readout.
  const [hoverI, setHoverI] = useState<number | null>(null);
  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!geom) return;
      const i = Math.min(shown.length - 1, Math.max(0, Math.floor(e.nativeEvent.offsetX / geom.barW)));
      setHoverI(i);
    },
    [geom, shown.length],
  );
  const hb: FlowBucket | null = hoverI != null ? shown[hoverI] ?? null : null;

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  const statusColor =
    status === 'open' ? 'text-term-up' : status === 'connecting' ? 'text-term-amber' : 'text-term-down';
  const cvdColor = summary.delta > 0 ? 'text-term-up' : summary.delta < 0 ? 'text-term-down' : 'text-term-text';
  const buyPct = Math.round(summary.buyRatio * 100);

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">order flow · CVD = Σ(buy−sell)</span>
        <div className="ml-auto flex items-center gap-2 tabular-nums">
          <span className="text-term-muted">CVD</span>
          <span className={`font-semibold ${cvdColor}`}>{fmtSignedCompact(summary.delta)}</span>
          <span className="flex items-center gap-1 text-term-muted">
            <span className="relative inline-block h-1.5 w-10 overflow-hidden rounded-sm bg-term-down/50">
              <span className="absolute inset-y-0 left-0 bg-term-up" style={{ width: `${buyPct}%` }} />
            </span>
            {buyPct}% buy
          </span>
          <span className="text-term-dim">{summary.trades} prints</span>
          <span className={statusColor} title={`stream ${status}`}>
            ●
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={wrapRef}
          className="absolute inset-0 cursor-crosshair"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverI(null)}
        >
          {geom && plot ? (
            <svg width={geom.W} height={geom.H} className="block">
              {/* CVD pane */}
              <line
                x1={0}
                x2={geom.W}
                y1={geom.zeroY}
                y2={geom.zeroY}
                stroke="rgba(122,127,135,0.4)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <polyline points={plot.linePts} fill="none" stroke="rgba(255,176,0,0.9)" strokeWidth={1.25} />
              <text x={3} y={10} className="text-term-dim" fill="currentColor" style={{ fontSize: 9 }}>
                CVD
              </text>
              <text
                x={geom.W - 3}
                y={10}
                textAnchor="end"
                className="text-term-muted"
                fill="currentColor"
                style={{ fontSize: 9 }}
              >
                {fmtSignedCompact(geom.maxC)}
              </text>
              <text
                x={geom.W - 3}
                y={geom.h1 - 3}
                textAnchor="end"
                className="text-term-muted"
                fill="currentColor"
                style={{ fontSize: 9 }}
              >
                {fmtSignedCompact(geom.minC)}
              </text>

              {/* Delta histogram pane */}
              <line
                x1={0}
                x2={geom.W}
                y1={geom.deltaMid}
                y2={geom.deltaMid}
                stroke="rgba(122,127,135,0.4)"
                strokeWidth={1}
              />
              {plot.bars}
              <text
                x={3}
                y={geom.deltaTop + 9}
                className="text-term-dim"
                fill="currentColor"
                style={{ fontSize: 9 }}
              >
                Δ / {BUCKET_MS / 1000}s
              </text>

              {/* Crosshair */}
              {hb && hoverI != null && (
                <line
                  x1={hoverI * geom.barW + geom.barW / 2}
                  x2={hoverI * geom.barW + geom.barW / 2}
                  y1={0}
                  y2={geom.H}
                  stroke="rgba(207,210,214,0.3)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              )}
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center text-term-muted">Waiting for prints…</div>
          )}

          {hb && (
            <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-sm border border-term-border bg-term-header px-1.5 py-0.5 tabular-nums text-term-text shadow">
              <span className="text-term-muted">Δ </span>
              <span className={hb.delta >= 0 ? 'text-term-up' : 'text-term-down'}>
                {fmtSignedCompact(hb.delta)}
              </span>
              <span className="text-term-muted"> · CVD </span>
              <span>{fmtSignedCompact(hb.cvd)}</span>
              <span className="text-term-dim"> · {hb.trades}t</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
