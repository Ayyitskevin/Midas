import { describe, it, expect } from 'vitest';
import {
  toSnapshot,
  buildDepthGrid,
  depthCellColor,
  priceToY,
  type DepthSnapshot,
} from '@/lib/depthmap';
import type { OrderBook } from '@midas/shared';

function book(bids: [number, number][], asks: [number, number][], t = 1): OrderBook {
  return {
    symbol: 'BTC/USDT',
    bids: bids.map(([price, amount]) => ({ price, amount })),
    asks: asks.map(([price, amount]) => ({ price, amount })),
    timestamp: t,
  };
}

function snap(mid: number, bids: [number, number][], asks: [number, number][], t = 1): DepthSnapshot {
  return {
    t,
    mid,
    bids: bids.map(([price, amount]) => ({ price, amount })),
    asks: asks.map(([price, amount]) => ({ price, amount })),
  };
}

describe('toSnapshot', () => {
  it('computes the mid from the best bid/ask', () => {
    const s = toSnapshot(book([[99.9, 5]], [[100.1, 7]]));
    expect(s?.mid).toBeCloseTo(100, 6);
    expect(s?.t).toBe(1);
  });

  it('returns null when a side is empty', () => {
    expect(toSnapshot(book([], [[100.1, 7]]))).toBeNull();
    expect(toSnapshot(book([[99.9, 5]], []))).toBeNull();
  });
});

describe('buildDepthGrid', () => {
  it('returns null for empty input or non-positive rows', () => {
    expect(buildDepthGrid([], 4)).toBeNull();
    expect(buildDepthGrid([snap(100, [[99.9, 1]], [[100.1, 1]])], 0)).toBeNull();
  });

  it('places asks above bids and tracks the max cell size', () => {
    const s = snap(100, [[99.9, 5], [99.5, 10]], [[100.1, 7], [100.5, 3]]);
    const grid = buildDepthGrid([s], 4)!;
    expect(grid).not.toBeNull();
    expect(grid.rows).toBe(4);
    expect(grid.columns).toHaveLength(1);

    const { cells } = grid.columns[0];
    // Top rows hold the asks (highest prices), bottom rows the bids.
    expect(cells[0].ask).toBe(3); // 100.5 — highest ask, top row
    expect(cells[1].ask).toBe(7); // 100.1
    expect(cells[2].bid).toBe(5); // 99.9
    expect(cells[3].bid).toBe(10); // 99.5 — lowest bid, bottom row
    // Sides don't bleed into each other.
    expect(cells[0].bid).toBe(0);
    expect(cells[3].ask).toBe(0);
    expect(grid.maxCell).toBe(10);
  });

  it('sums multiple levels that fall in the same bucket', () => {
    // Two asks close enough to share a coarse bucket.
    const grid = buildDepthGrid([snap(100, [[99.0, 1]], [[101.0, 4], [100.99, 6]])], 3)!;
    const total = grid.columns[0].cells.reduce((a, c) => a + c.ask, 0);
    expect(total).toBe(10);
  });

  it('uses one shared price axis so a wall aligns across columns', () => {
    // Column 2 has an extra higher ask that widens the window for BOTH columns;
    // the 100.10 level must still land on the same row in each.
    const a = snap(100, [[99.9, 5]], [[100.1, 8]], 1);
    const b = snap(100, [[99.9, 5]], [[100.1, 8], [100.9, 2]], 2);
    const grid = buildDepthGrid([a, b], 8)!;
    const rowIn = (col: number) => grid.columns[col].cells.findIndex((c) => c.ask === 8);
    expect(rowIn(0)).toBeGreaterThanOrEqual(0);
    expect(rowIn(0)).toBe(rowIn(1));
  });

  it('clamps the window so a stray far level cannot flatten the scale', () => {
    // 200 is far outside ±2% of mid 100 → excluded from the price window.
    const grid = buildDepthGrid([snap(100, [[99.9, 5]], [[100.1, 7], [200, 1]])], 4)!;
    expect(grid.priceMax).toBeLessThan(110);
  });
});

describe('depthCellColor', () => {
  it('is green for bid-dominant, red for ask-dominant, null when empty', () => {
    expect(depthCellColor({ bid: 10, ask: 1 }, 10)).toContain('38,194,129');
    expect(depthCellColor({ bid: 1, ask: 10 }, 10)).toContain('239,77,86');
    expect(depthCellColor({ bid: 0, ask: 0 }, 10)).toBeNull();
  });

  it('scales opacity up with resting size', () => {
    const alpha = (c: string) => Number(c.slice(c.lastIndexOf(',') + 1, c.lastIndexOf(')')));
    const small = depthCellColor({ bid: 1, ask: 0 }, 100)!;
    const big = depthCellColor({ bid: 100, ask: 0 }, 100)!;
    expect(alpha(big)).toBeGreaterThan(alpha(small));
  });
});

describe('priceToY', () => {
  it('maps the top price to 0 and the bottom price to the full height', () => {
    expect(priceToY(110, 100, 110, 200)).toBe(0);
    expect(priceToY(100, 100, 110, 200)).toBe(200);
    expect(priceToY(105, 100, 110, 200)).toBeCloseTo(100, 6);
  });

  it('is clamped and safe when the range is degenerate', () => {
    expect(priceToY(105, 100, 100, 200)).toBe(0);
  });
});
