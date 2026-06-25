/**
 * Order-book depth heatmap math. A series of L2 snapshots is bucketed into a
 * shared price × time grid: every column (a moment in time) maps its resting
 * size onto the *same* price axis, so persistent liquidity shows up as
 * horizontal streaks and pulled walls leave gaps. Kept free of React so it can
 * be unit-tested in isolation.
 */

import type { OrderBook, OrderBookLevel } from '@midas/shared';

/** One order-book snapshot reduced to what the heatmap needs. */
export interface DepthSnapshot {
  t: number;
  mid: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

/** Resting size on each side within a single price bucket. */
export interface DepthCell {
  bid: number;
  ask: number;
}

/** One time-slice (a vertical strip) of the heatmap. */
export interface DepthColumn {
  t: number;
  mid: number;
  cells: DepthCell[];
}

/** A fully bucketed price × time grid ready to render. */
export interface DepthGrid {
  columns: DepthColumn[];
  rows: number;
  priceMin: number;
  priceMax: number;
  /** Largest single-cell resting size, for opacity normalization. */
  maxCell: number;
}

/** Reduce a raw order book to a snapshot; null if it has no two-sided top. */
export function toSnapshot(book: OrderBook): DepthSnapshot | null {
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  if (!(bestBid > 0) || !(bestAsk > 0)) return null;
  return {
    t: book.timestamp || 0,
    mid: (bestBid + bestAsk) / 2,
    bids: book.bids,
    asks: book.asks,
  };
}

/**
 * Bucket a series of snapshots into a shared price × time grid. The price axis
 * is common to every column so resting liquidity lines up as horizontal
 * streaks. The window spans the union of all levels, clamped to ±maxBandPct of
 * the latest mid so a single stray level can't flatten the whole scale.
 */
export function buildDepthGrid(
  snapshots: DepthSnapshot[],
  rows: number,
  maxBandPct = 2,
): DepthGrid | null {
  if (snapshots.length === 0 || rows <= 0) return null;
  const latestMid = snapshots[snapshots.length - 1].mid;
  if (!(latestMid > 0)) return null;

  const bandLo = latestMid * (1 - maxBandPct / 100);
  const bandHi = latestMid * (1 + maxBandPct / 100);

  let lo = Infinity;
  let hi = -Infinity;
  for (const s of snapshots) {
    for (const l of s.bids) {
      if (l.price < bandLo || l.price > bandHi) continue;
      if (l.price < lo) lo = l.price;
      if (l.price > hi) hi = l.price;
    }
    for (const l of s.asks) {
      if (l.price < bandLo || l.price > bandHi) continue;
      if (l.price < lo) lo = l.price;
      if (l.price > hi) hi = l.price;
    }
  }
  if (!(hi > lo)) return null;

  // A small margin so the extreme levels don't sit flush against the edges.
  const pad = (hi - lo) * 0.02;
  lo -= pad;
  hi += pad;
  const span = hi - lo;

  const rowFor = (price: number): number => {
    const frac = (hi - price) / span; // 0 at the top (hi) … 1 at the bottom (lo)
    return Math.min(rows - 1, Math.max(0, Math.floor(frac * rows)));
  };

  let maxCell = 0;
  const columns: DepthColumn[] = snapshots.map((s) => {
    const cells: DepthCell[] = Array.from({ length: rows }, () => ({ bid: 0, ask: 0 }));
    for (const l of s.bids) {
      if (l.price < lo || l.price > hi) continue;
      cells[rowFor(l.price)].bid += l.amount;
    }
    for (const l of s.asks) {
      if (l.price < lo || l.price > hi) continue;
      cells[rowFor(l.price)].ask += l.amount;
    }
    for (const c of cells) {
      const m = c.bid > c.ask ? c.bid : c.ask;
      if (m > maxCell) maxCell = m;
    }
    return { t: s.t, mid: s.mid, cells };
  });

  return { columns, rows, priceMin: lo, priceMax: hi, maxCell };
}

const BID_RGB = '38,194,129'; // term-up
const ASK_RGB = '239,77,86'; // term-down

/**
 * Heat colour for a cell: green when bids dominate the bucket, red when asks
 * do, opacity scaled by resting size on a log curve (order sizes span orders of
 * magnitude). Null for empty buckets so they render as bare background.
 */
export function depthCellColor(cell: DepthCell, maxCell: number): string | null {
  const size = cell.bid > cell.ask ? cell.bid : cell.ask;
  if (size <= 0 || maxCell <= 0) return null;
  const t = Math.min(1, Math.log1p(size) / Math.log1p(maxCell));
  const alpha = (0.1 + 0.8 * t).toFixed(3);
  return `rgba(${cell.bid >= cell.ask ? BID_RGB : ASK_RGB},${alpha})`;
}

/** Top-edge Y pixel for a price within a rendered grid of the given height. */
export function priceToY(price: number, priceMin: number, priceMax: number, height: number): number {
  if (priceMax <= priceMin) return 0;
  const frac = (priceMax - price) / (priceMax - priceMin);
  return Math.min(height, Math.max(0, frac * height));
}
