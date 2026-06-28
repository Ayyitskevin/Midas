import { describe, it, expect } from 'vitest';
import { computeMcginley, mcginleyBoard, sortMcginley, type McginleyRow } from './mcginley';

// Primary fixture — independently verified by a multi-agent workflow against the
// canonical McGinley Dynamic (TradingView / Investopedia / pandas-ta; reference
// impl + two adversarial recomputations, all machine-zero). Seed md[0]=close[0],
// constant = N (k=1), exponent 4, recursion on the prior md output.
const up = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109];
// Mirror decline → the line trails above price and slopes down.
const down = [109, 107, 108, 106, 104, 105, 103, 101, 102, 100];

describe('computeMcginley', () => {
  it('matches the workflow-verified McGinley value on a rising series', () => {
    const r = computeMcginley(up, 10)!;
    expect(r.md).toBeCloseTo(102.985011, 6);
    expect(r.prev).toBeCloseTo(102.475291, 6);
    expect(r.distPct).toBeCloseTo(5.840645, 5);
    expect(r.slopePct).toBeCloseTo(0.497408, 5);
    expect(r.direction).toBe('up');
    expect(r.n).toBe(10);
  });

  it('slopes down and trails above price on a decline', () => {
    const r = computeMcginley(down, 10)!;
    expect(r.distPct).toBeLessThan(0); // price below the line
    expect(r.slopePct).toBeLessThan(0);
    expect(r.direction).toBe('down');
  });

  it('seeds md[0] with the first close', () => {
    const r = computeMcginley([100, 100], 10)!;
    expect(r.md).toBeCloseTo(100, 9); // flat input stays at the seed
    expect(r.distPct).toBeCloseTo(0, 9);
  });

  it('keeps distPct, slopePct and direction scale-invariant', () => {
    const r = computeMcginley(up, 10)!;
    const scaled = computeMcginley(
      up.map((c) => c * 1000),
      10,
    )!;
    expect(scaled.direction).toBe(r.direction);
    expect(scaled.distPct).toBeCloseTo(r.distPct, 9);
    expect(scaled.slopePct).toBeCloseTo(r.slopePct, 9);
  });

  it('returns null with fewer than 2 closes or a bad period', () => {
    expect(computeMcginley([100], 10)).toBeNull();
    expect(computeMcginley([], 10)).toBeNull();
    expect(computeMcginley(up, 0)).toBeNull();
  });
});

describe('mcginleyBoard', () => {
  const series = [
    { symbol: 'HIGH', closes: up }, // distPct ≈ +5.84, slope +0.50
    { symbol: 'LOW', closes: down }, // distPct ≈ −4.80, slope −0.68
  ];

  it('defaults to sorting by distance above the line', () => {
    const rows = mcginleyBoard(series, 'dist', 10);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
  });

  it('sorts by slope descending', () => {
    const rows = mcginleyBoard(series, 'slope', 10);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
  });

  it('skips symbols with too little history', () => {
    const rows = mcginleyBoard(
      [
        { symbol: 'OK', closes: up },
        { symbol: 'THIN', closes: [100] },
      ],
      'dist',
      10,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortMcginley', () => {
  it('orders by distPct descending', () => {
    const rows = [
      { symbol: 'A', distPct: 0.3, slopePct: 0 },
      { symbol: 'B', distPct: 1.2, slopePct: 0 },
      { symbol: 'C', distPct: -0.5, slopePct: 0 },
    ] as McginleyRow[];
    expect(sortMcginley(rows, 'dist').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
