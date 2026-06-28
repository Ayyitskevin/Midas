import { describe, it, expect } from 'vitest';
import { computeFrsi, frsiBoard, sortFrsi, type FrsiRow } from './frsi';

// Primary fixture — independently verified by a multi-agent workflow (reference
// impl + two adversarial recomputations, all machine-zero) AND re-checked here.
// closes → Wilder RSI(9) → windowed (9) Fisher (0.66/0.67 input smoothing, ±0.999
// clamp, 0.5/0.5 output smoothing). The late downtrend pins raw=0 repeatedly so
// the Fisher saturates negative (monotonic fall → no turn).
const primary = [
  100, 101, 102, 101, 103, 104, 103, 105, 106, 107, 106, 108, 109, 108, 110, 109, 108, 107, 108, 106,
  105, 104, 105, 103,
];

// Climb then one sharp down close → Fisher turns down on the last bar (bear cross).
const bear = [100, 99, 101, 100, 102, 101, 103, 102, 104, 103, 105, 107, 109, 112, 115, 119, 123, 128, 133, 138, 110];
// Mirror: decline then one sharp up close → Fisher turns up (bull cross).
const bull = [140, 139, 141, 140, 138, 139, 137, 138, 136, 135, 133, 131, 128, 125, 121, 117, 112, 107, 102, 98, 108];

describe('computeFrsi', () => {
  it('saturates negative on a late downtrend (no turn)', () => {
    const r = computeFrsi(primary, 9, 9)!;
    expect(r.fisher).toBeCloseTo(-2.294325, 5);
    expect(r.trigger).toBeCloseTo(-2.027177, 5);
    expect(r.rsi).toBeCloseTo(39.895517, 5);
    expect(r.cross).toBe('none');
    expect(r.n).toBe(24);
  });

  it('fires a bear cross when the Fisher turns down on the last bar', () => {
    const r = computeFrsi(bear, 9, 9)!;
    expect(r.fisher).toBeCloseTo(0.770131, 5);
    expect(r.trigger).toBeCloseTo(1.261493, 5);
    expect(r.cross).toBe('bear');
  });

  it('fires a bull cross when the Fisher turns up on the last bar', () => {
    const r = computeFrsi(bull, 9, 9)!;
    expect(r.fisher).toBeCloseTo(-0.770131, 5);
    expect(r.trigger).toBeCloseTo(-1.261493, 5);
    expect(r.cross).toBe('bull');
  });

  it('reports the latest underlying RSI alongside the Fisher', () => {
    const r = computeFrsi(primary, 9, 9)!;
    expect(r.rsi).toBeGreaterThan(0);
    expect(r.rsi).toBeLessThan(100);
  });

  it('stays finite on a flat (zero-range) series via the clamp', () => {
    const r = computeFrsi(new Array(30).fill(50), 9, 9)!;
    expect(Number.isFinite(r.fisher)).toBe(true);
    expect(r.fisher).toBeLessThan(0); // flat RSI → raw=0 each bar drives the Fisher negative
  });

  it('returns null with fewer than rsiPeriod + fisherPeriod closes', () => {
    expect(computeFrsi(primary.slice(0, 17), 9, 9)).toBeNull();
    expect(computeFrsi([], 9, 9)).toBeNull();
  });

  it('rejects non-positive periods', () => {
    expect(computeFrsi(primary, 0, 9)).toBeNull();
    expect(computeFrsi(primary, 9, 0)).toBeNull();
  });
});

describe('frsiBoard', () => {
  const series = [
    { symbol: 'BEAR', closes: bear }, // fisher ≈ +0.77, rsi ≈ 44.7
    { symbol: 'BULL', closes: bull }, // fisher ≈ −0.77, rsi ≈ 31.1
    { symbol: 'PRIM', closes: primary }, // fisher ≈ −2.29, rsi ≈ 39.9
  ];

  it('defaults to sorting by Fisher descending', () => {
    const rows = frsiBoard(series, 'fisher', 9, 9);
    expect(rows.map((r) => r.symbol)).toEqual(['BEAR', 'BULL', 'PRIM']);
  });

  it('sorts by underlying RSI descending', () => {
    const rows = frsiBoard(series, 'rsi', 9, 9);
    expect(rows.map((r) => r.symbol)).toEqual(['BEAR', 'PRIM', 'BULL']);
  });

  it('sorts by symbol', () => {
    const rows = frsiBoard(series, 'symbol', 9, 9);
    expect(rows.map((r) => r.symbol)).toEqual(['BEAR', 'BULL', 'PRIM']);
  });

  it('skips symbols with too little history', () => {
    const rows = frsiBoard(
      [
        { symbol: 'OK', closes: primary },
        { symbol: 'THIN', closes: primary.slice(0, 17) },
      ],
      'fisher',
      9,
      9,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortFrsi', () => {
  it('orders by Fisher descending', () => {
    const rows = [
      { symbol: 'A', fisher: 0.3, rsi: 50 },
      { symbol: 'B', fisher: 1.2, rsi: 50 },
      { symbol: 'C', fisher: -0.5, rsi: 50 },
    ] as FrsiRow[];
    expect(sortFrsi(rows, 'fisher').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
