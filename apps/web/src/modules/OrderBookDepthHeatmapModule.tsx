import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OrderBook } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useStream, useStreamStatus } from '@/lib/stream';
import { fmtPrice, fmtCompact } from '@/lib/format';
import {
  buildDepthGrid,
  depthCellColor,
  priceToY,
  toSnapshot,
  type DepthSnapshot,
} from '@/lib/depthmap';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BUFFER_CAP = 120; // snapshots retained in memory
const TARGET_COL_W = 5; // px per time column
const TARGET_CELL_H = 9; // px per price bucket

export function OrderBookDepthHeatmapModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;

  // REST seed for instant first paint; the live stream then appends columns.
  const { data: seed, error, loading, refresh } = useFetch(
    (signal) => api.orderbook(symbol as string, 50, signal),
    [symbol],
    { enabled: Boolean(symbol) },
  );
  const status = useStreamStatus();

  const [snaps, setSnaps] = useState<DepthSnapshot[]>([]);
  useEffect(() => setSnaps([]), [symbol]);

  // Seed a first column from REST so the panel isn't blank before frame one.
  useEffect(() => {
    if (!seed) return;
    const s = toSnapshot(seed);
    if (s) setSnaps((prev) => (prev.length === 0 ? [s] : prev));
  }, [seed]);

  useStream(
    'orderbook',
    symbol,
    useCallback((d: unknown) => {
      const s = toSnapshot(d as OrderBook);
      if (!s) return;
      setSnaps((prev) => {
        if (prev.length && prev[prev.length - 1].t === s.t) return prev;
        const next = [...prev, s];
        return next.length > BUFFER_CAP ? next.slice(next.length - BUFFER_CAP) : next;
      });
    }, []),
  );

  // Measure the plot area so the grid can lay out in real pixels.
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

  const rows = Math.max(16, Math.min(30, Math.round(size.h / TARGET_CELL_H) || 16));
  const visibleCols = Math.max(8, Math.min(BUFFER_CAP, Math.floor(size.w / TARGET_COL_W) || 8));
  const shown = useMemo(
    () => (snaps.length > visibleCols ? snaps.slice(snaps.length - visibleCols) : snaps),
    [snaps, visibleCols],
  );
  const grid = useMemo(
    () => (size.h > 0 ? buildDepthGrid(shown, rows) : null),
    [shown, rows, size.h],
  );

  const rects = useMemo(() => {
    if (!grid || size.w <= 0 || size.h <= 0) return null;
    const colW = size.w / grid.columns.length;
    const cellH = size.h / grid.rows;
    return grid.columns.flatMap((col, j) =>
      col.cells.map((cell, r) => {
        const color = depthCellColor(cell, grid.maxCell);
        if (!color) return null;
        return (
          <rect
            key={`${j}-${r}`}
            x={j * colW}
            y={r * cellH}
            width={colW + 0.6}
            height={cellH + 0.6}
            fill={color}
          />
        );
      }),
    );
  }, [grid, size]);

  const midPath = useMemo(() => {
    if (!grid || size.w <= 0) return '';
    const colW = size.w / grid.columns.length;
    return grid.columns
      .map(
        (c, j) =>
          `${(j * colW + colW / 2).toFixed(1)},${priceToY(c.mid, grid.priceMin, grid.priceMax, size.h).toFixed(1)}`,
      )
      .join(' ');
  }, [grid, size]);

  const axisLabels = useMemo(() => {
    if (!grid) return [];
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => ({
      price: grid.priceMax - (i / n) * (grid.priceMax - grid.priceMin),
      y: (i / n) * size.h,
    }));
  }, [grid, size.h]);

  // Crosshair readout — price and resting size under the cursor.
  const [hover, setHover] = useState<{ x: number; y: number; price: number; bid: number; ask: number } | null>(
    null,
  );
  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!grid || size.w <= 0 || size.h <= 0) return;
      const x = e.nativeEvent.offsetX;
      const y = e.nativeEvent.offsetY;
      const colW = size.w / grid.columns.length;
      const cellH = size.h / grid.rows;
      const col = Math.min(grid.columns.length - 1, Math.max(0, Math.floor(x / colW)));
      const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / cellH)));
      const cell = grid.columns[col]?.cells[row];
      const price = grid.priceMax - (y / size.h) * (grid.priceMax - grid.priceMin);
      setHover({ x, y, price, bid: cell?.bid ?? 0, ask: cell?.ask ?? 0 });
    },
    [grid, size],
  );

  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const bestBid = latest?.bids[0]?.price ?? 0;
  const bestAsk = latest?.asks[0]?.price ?? 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const spreadPct = latest?.mid ? (spread / latest.mid) * 100 : 0;

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  const statusColor =
    status === 'open' ? 'text-term-up' : status === 'connecting' ? 'text-term-amber' : 'text-term-down';

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">depth heatmap · green bid / red ask · bright = size</span>
        <div className="ml-auto flex items-center gap-2 tabular-nums">
          {latest && (
            <>
              <span className="font-semibold text-term-text">{fmtPrice(latest.mid)}</span>
              <span className="text-term-muted">spr {spreadPct.toFixed(3)}%</span>
            </>
          )}
          <span className={statusColor} title={`stream ${status}`}>
            ●
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && snaps.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label={`Loading ${symbol} book`} />
          </div>
        )}
        {error && snaps.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} onRetry={refresh} />
          </div>
        )}

        <div
          ref={wrapRef}
          className="absolute inset-0 cursor-crosshair"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {grid && size.w > 0 && size.h > 0 && (
            <svg width={size.w} height={size.h} className="block">
              {rects}
              {midPath && (
                <polyline points={midPath} fill="none" stroke="rgba(255,176,0,0.6)" strokeWidth={1} />
              )}
              {hover && (
                <line
                  x1={0}
                  x2={size.w}
                  y1={hover.y}
                  y2={hover.y}
                  stroke="rgba(207,210,214,0.35)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              )}
              {axisLabels.map((l, i) => (
                <text
                  key={i}
                  x={size.w - 3}
                  y={Math.min(size.h - 2, Math.max(8, l.y + (i === 0 ? 8 : 3)))}
                  textAnchor="end"
                  className="text-term-muted"
                  fill="currentColor"
                  style={{ fontSize: 9 }}
                >
                  {fmtPrice(l.price)}
                </text>
              ))}
            </svg>
          )}

          {grid && snaps.length > 0 && snaps.length < 3 && (
            <div className="absolute left-2 top-2 text-term-dim">building history…</div>
          )}

          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded-sm border border-term-border bg-term-header px-1.5 py-0.5 tabular-nums text-term-text shadow"
              style={{
                left: Math.min(size.w - 96, hover.x + 10),
                top: Math.min(size.h - 30, hover.y + 10),
              }}
            >
              <div className="text-term-muted">{fmtPrice(hover.price)}</div>
              <div>
                <span className="text-term-up">{fmtCompact(hover.bid)}</span>
                {' / '}
                <span className="text-term-down">{fmtCompact(hover.ask)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
