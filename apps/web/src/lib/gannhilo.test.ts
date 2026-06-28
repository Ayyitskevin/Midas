import { describe, it, expect } from 'vitest';
import { computeGannHilo, gannHiloBoard, sortGannHilo, type GannHiloBar, type GannHiloRow } from './gannhilo';

const bar = (high: number, low: number, close: number): GannHiloBar => ({ high, low, close });

// Hand-computed with N=2. SMA(high)/SMA(low) over 2 bars; trend compares close to
// the PRIOR bar's SMAs; activator = low-SMA (up) / high-SMA (down).
//   i2 close 12 > smaHigh[1]=10.5 → up   (activator smaLow[2]=10)
//   i3 close 11 in [10,12]        → up   (carry; activator smaLow[3]=10.5)
//   i4 close 8.5 < smaLow[3]=10.5 → down (activator smaHigh[4]=11)
//   i5 close 7.5 < smaLow[4]=9    → down (activator smaHigh[5]=9.5)
const seq = [bar(10, 8, 9), bar(11, 9, 10), bar(13, 11, 12), bar(12, 10, 11), bar(10, 8, 8.5), bar(9, 7, 7.5)];

describe('computeGannHilo', () => {
  it('reads a downtrend with the activator above price', () => {
    const r = computeGannHilo(seq, 2)!;
    expect(r.direction).toBe('down');
    expect(r.activator).toBeCloseTo(9.5, 9);
    expect(r.age).toBe(2);
    expect(r.flip).toBe(false);
    expect(r.distPct).toBeCloseTo(-21.052632, 5); // (7.5 − 9.5)/9.5
    expect(r.n).toBe(6);
  });

  it('reads an uptrend with the activator below price', () => {
    const r = computeGannHilo(seq.slice(0, 4), 2)!;
    expect(r.direction).toBe('up');
    expect(r.activator).toBeCloseTo(10.5, 9);
    expect(r.age).toBe(2);
    expect(r.distPct).toBeCloseTo(4.761905, 5); // (11 − 10.5)/10.5
  });

  it('flags a fresh flip when the close pierces the opposite band', () => {
    const r = computeGannHilo(seq.slice(0, 5), 2)!;
    expect(r.direction).toBe('down');
    expect(r.age).toBe(1);
    expect(r.flip).toBe(true);
    expect(r.activator).toBeCloseTo(11, 9);
  });

  it('keeps direction and distPct scale-invariant', () => {
    const r = computeGannHilo(seq, 2)!;
    const scaled = computeGannHilo(
      seq.map((b) => bar(b.high * 1000, b.low * 1000, b.close * 1000)),
      2,
    )!;
    expect(scaled.direction).toBe(r.direction);
    expect(scaled.distPct).toBeCloseTo(r.distPct, 9);
  });

  it('returns null with fewer than period + 1 bars or a bad period', () => {
    expect(computeGannHilo(seq.slice(0, 2), 2)).toBeNull();
    expect(computeGannHilo([], 2)).toBeNull();
    expect(computeGannHilo(seq, 0)).toBeNull();
  });
});

describe('gannHiloBoard', () => {
  const series = [
    { symbol: 'UP', bars: seq.slice(0, 4) }, // up, age 2 → score +2
    { symbol: 'FLIP', bars: seq.slice(0, 5) }, // down, age 1 → score −1
    { symbol: 'FULL', bars: seq }, // down, age 2 → score −2
  ];

  it('defaults to sorting by signed trend persistence (longest uptrends first)', () => {
    const rows = gannHiloBoard(series, 'trend', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'FLIP', 'FULL']);
  });

  it('sorts by symbol', () => {
    const rows = gannHiloBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['FLIP', 'FULL', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = gannHiloBoard(
      [
        { symbol: 'OK', bars: seq },
        { symbol: 'THIN', bars: seq.slice(0, 2) },
      ],
      'trend',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortGannHilo', () => {
  it('orders up-trends (by age) above down-trends', () => {
    const rows = [
      { symbol: 'A', direction: 'up', age: 2, distPct: 1 },
      { symbol: 'B', direction: 'up', age: 9, distPct: 1 },
      { symbol: 'C', direction: 'down', age: 5, distPct: 1 },
    ] as GannHiloRow[];
    expect(sortGannHilo(rows, 'trend').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
