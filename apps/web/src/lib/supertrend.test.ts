import { describe, it, expect } from 'vitest';
import { computeSupertrend, superFlip, superBoard, sortSuper, type SuperBar, type SuperRow } from './supertrend';

// Steady up-trend, no bar-to-bar overlap → Supertrend stays the lower band below price.
const up: SuperBar[] = Array.from({ length: 25 }, (_, i) => ({ high: 10 + 2 * i, low: 8 + 2 * i, close: 9 + 2 * i }));
// Steady down-trend → Supertrend stays the upper band above price.
const down: SuperBar[] = Array.from({ length: 25 }, (_, i) => ({ high: 100 - 2 * i, low: 98 - 2 * i, close: 99 - 2 * i }));

describe('superFlip', () => {
  it('classifies direction changes', () => {
    expect(superFlip(1, 1)).toBe('none');
    expect(superFlip(-1, -1)).toBe('none');
    expect(superFlip(-1, 1)).toBe('bull');
    expect(superFlip(1, -1)).toBe('bear');
  });
});

describe('computeSupertrend', () => {
  it('reads a steady up-trend as bullish with price above the stop', () => {
    const r = computeSupertrend(up, 10, 3)!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe(1);
    expect(r.distPct).toBeGreaterThan(0); // close above the trailing stop
    expect(r.supertrend).toBeLessThan(up[up.length - 1].close);
    expect(r.flip).toBe('none'); // no recent flip
    expect(r.n).toBe(25);
  });

  it('reads a steady down-trend as bearish with price below the stop', () => {
    const r = computeSupertrend(down, 10, 3)!;
    expect(r.direction).toBe(-1);
    expect(r.distPct).toBeLessThan(0);
    expect(r.supertrend).toBeGreaterThan(down[down.length - 1].close);
  });

  it('returns null with too little history', () => {
    expect(computeSupertrend([], 10)).toBeNull();
    expect(computeSupertrend(up.slice(0, 11), 10)).toBeNull(); // < period + 2
  });
});

describe('superBoard', () => {
  const series = [
    { symbol: 'UP', bars: up },
    { symbol: 'DOWN', bars: down },
  ];

  it('defaults to sorting by distance descending (up-trends first)', () => {
    const rows = superBoard(series, 'distPct', 10, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].direction).toBe(1);
    expect(rows[1].direction).toBe(-1);
  });

  it('sorts by symbol', () => {
    const rows = superBoard(series, 'symbol', 10, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = superBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: up.slice(0, 8) },
      ],
      'distPct',
      10,
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortSuper', () => {
  it('orders by distPct descending', () => {
    const rows = [
      { symbol: 'A', distPct: 2 },
      { symbol: 'B', distPct: 9 },
      { symbol: 'C', distPct: -4 },
    ] as SuperRow[];
    expect(sortSuper(rows, 'distPct').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
