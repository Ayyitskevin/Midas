import { describe, it, expect } from 'vitest';
import { zlemaSeries, computeZlema, zlemaBoard, sortZlema, type ZlemaRow } from './zlema';

// Hand fixture, period 5 (lag = floor(4/2) = 2). De-lagged input = 2·close − close[2];
// EMA(period 5) of it. Cross-checked by a scratch script.
const FIXTURE = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15];

describe('zlemaSeries', () => {
  it('matches the hand-computed series (lag 2)', () => {
    const s = zlemaSeries(FIXTURE, 5);
    expect(Number.isNaN(s[0])).toBe(true);
    expect(Number.isNaN(s[1])).toBe(true);
    expect(s[2]).toBeCloseTo(14, 10); // first de-lagged EMA value seeds at 2·12 − 10 = 14
    expect(s[9]).toBeCloseTo(15.751714677640608, 10);
  });

  it('reduces to the constant on a flat series (de-lag leaves it unchanged)', () => {
    expect(zlemaSeries(new Array(20).fill(50), 5).at(-1)!).toBeCloseTo(50, 10);
  });
});

describe('computeZlema', () => {
  it('reports the verified slope% / dist% off the hand fixture', () => {
    const r = computeZlema(FIXTURE, 5)!;
    expect(r.zlema).toBeCloseTo(15.751714677640608, 10);
    expect(r.slopePct).toBeCloseTo(-2.330526494854127, 10);
    expect(r.distPct).toBeCloseTo(-4.7722720543412285, 10);
    expect(r.dir).toBe('down');
    expect(r.n).toBe(10);
  });

  it('tracks price closely on a trend (low lag) and is scale-invariant', () => {
    const ramp = Array.from({ length: 30 }, (_, i) => 100 + 2 * i);
    const big = ramp.map((c) => c * 1000);
    const r = computeZlema(ramp, 14)!;
    expect(Math.abs(r.distPct)).toBeLessThan(1); // near-zero lag vs the line
    expect(r.dir).toBe('up');
    expect(computeZlema(big, 14)!.distPct).toBeCloseTo(r.distPct, 9);
  });

  it('returns null with fewer than lag + period + 1 closes or bad params', () => {
    expect(computeZlema(FIXTURE.slice(0, 7), 5)).toBeNull(); // need ≥ 8
    expect(computeZlema([], 14)).toBeNull();
    expect(computeZlema(FIXTURE, 0)).toBeNull();
  });
});

describe('zlemaBoard / sortZlema', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i); // rising
  const down = Array.from({ length: 30 }, (_, i) => 130 - i); // falling
  const flat = new Array(30).fill(100); // flat
  const series = [
    { symbol: 'UP', closes: up },
    { symbol: 'DN', closes: down },
    { symbol: 'FL', closes: flat },
  ];

  it('sorts by slope% descending by default', () => {
    const rows = zlemaBoard(series, 'slope', 14);
    expect(rows[0].symbol).toBe('UP');
    expect(rows[rows.length - 1].symbol).toBe('DN');
  });

  it('sorts by symbol', () => {
    const rows = zlemaBoard(series, 'symbol', 14);
    expect(rows.map((r) => r.symbol)).toEqual(['DN', 'FL', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = zlemaBoard(
      [
        { symbol: 'OK', closes: up },
        { symbol: 'THIN', closes: up.slice(0, 12) },
      ],
      'slope',
      14,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortZlema orders a plain row set by dist% descending', () => {
    const rows = [
      { symbol: 'A', distPct: -1 },
      { symbol: 'B', distPct: 3 },
      { symbol: 'C', distPct: 0.5 },
    ] as ZlemaRow[];
    expect(sortZlema(rows, 'dist').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
